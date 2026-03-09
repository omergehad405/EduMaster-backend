const fs = require('fs');
const PDFParser = require('pdf2json');
const appError = require("../../utils/appError")
const asyncWrapper = require("../middlewares/asyncWrapper")
const User = require("../models/user.module")
const mongoose = require("mongoose")

const generateQuiz = asyncWrapper(async (req, res, next) => {
    const { type = 'mcq', time = 30, count = 5 } = req.body;
    const file = req.file;

    console.log('🎯 QUIZ GENERATION STARTED:', {
        type, time, count, file: file?.originalname
    });

    if (!file) return next(new appError('File required', 400));

    // Extract content
    let content = '';
    try {
        if (file.mimetype === 'application/pdf') {
            const buffer = fs.readFileSync(file.path);
            const pdfParser = new PDFParser();

            content = await new Promise((resolve, reject) => {
                pdfParser.on('pdfParser_dataReady', (pdfData) => {
                    const text = pdfData.Pages?.map(page =>
                        page.Texts?.map(t => decodeURIComponent(t.R?.[0]?.T || '')).join(' ')
                    ).join('\n\n') || '';
                    console.log('✅ PDF extracted:', text.slice(0, 200));
                    resolve(text.slice(0, 15000));
                });
                pdfParser.on('pdfParser_dataError', (err) => {
                    console.error('❌ PDF Parse Error:', err);
                    resolve('');
                });
                pdfParser.parseBuffer(buffer);
            });
        } else {
            content = fs.readFileSync(file.path, 'utf8').slice(0, 15000);
        }

        if (!content.trim()) {
            return next(new appError('No text extracted from file', 400));
        }
        console.log('📄 Content preview:', content.slice(0, 300));
    } catch (err) {
        console.error('❌ Content extraction failed:', err);
        return next(new appError('Failed to extract text from file', 400));
    }

    // BULLETPROOF Groq prompt
    const prompt = `Generate EXACTLY ${count} quiz questions from this text. 

IMPORTANT: RETURN ONLY VALID JSON ARRAY. NO OTHER TEXT. NO MARKDOWN. NO EXPLANATIONS.

TEXT: ${content.slice(0, 10000)}

${type === 'tf' ? 'TRUE/FALSE: options must be EXACTLY ["True", "False"]' : ''}
${type === 'mcq' ? 'MCQ: EXACTLY 4 options: ["A) text", "B) text", "C) text", "D) text"]' : ''}

JSON FORMAT:
[
  {
    "question": "Question text here?",
    "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
    "correctAnswer": "A) Option 1",
    "explanation": "Why this is correct"
  }
]`;

    console.log('📝 Sending to Groq...');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 3000,
            temperature: 0.1
        })
    });

    if (!groqResponse.ok) {
        const errorData = await groqResponse.json();
        console.error('❌ Groq API Error:', errorData);
        return next(new appError(`AI service error: ${errorData.error?.message || 'Unknown error'}`, 500));
    }

    const groqData = await groqResponse.json();
    console.log('📥 Groq raw response preview:', groqData.choices[0]?.message?.content?.slice(0, 300));

    if (!groqData.choices?.[0]?.message?.content) {
        return next(new appError('AI service failed to generate questions', 500));
    }

    let questions;
    try {
        // SUPER CLEAN parsing
        let rawContent = groqData.choices[0].message.content.trim();

        // Remove ALL common wrappers
        rawContent = rawContent
            .replace(/```json|```|json|```javascript/gi, '')
            .replace(/^\s*[\[\{].*?[\]\}]\s*$/s, match => match.trim())
            .trim();

        console.log('🧹 Cleaned content preview:', rawContent.slice(0, 300));

        questions = JSON.parse(rawContent);

        if (!Array.isArray(questions) || questions.length === 0 || questions.length > parseInt(count) + 2) {
            throw new Error(`Expected ${count} questions, got ${questions.length}`);
        }

        // Validate structure
        questions.slice(0, parseInt(count)).forEach((q, i) => {
            if (!q.question || !Array.isArray(q.options) || !q.correctAnswer || !q.explanation) {
                console.error(`❌ Invalid question ${i + 1}:`, q);
                throw new Error(`Question ${i + 1} missing required fields: question, options, correctAnswer, explanation`);
            }
        });

    } catch (parseError) {
        console.error('❌ JSON Parse Error:', parseError.message);
        console.error('💾 FULL raw Groq response:\n', groqData.choices.message.content);
        return next(new appError(`AI returned invalid format: ${parseError.message}`, 500));
    }

    const quizId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log('✅ Quiz generated successfully:', questions.length, 'questions');

    res.json({
        success: true,
        quizId,
        questions: questions.slice(0, parseInt(count)), // Trim to exact count
        type,
        time: parseInt(time),
        count: parseInt(count)
    });
});

const submitQuiz = asyncWrapper(async (req, res) => {
    const { quizId, answers, questions, fileName } = req.body;
    const userId = req.user.id;

    // Calculate score
    let score = 0;
    const userAnswers = answers.map((ans, idx) => {
        const correctIdx = questions[idx].options.indexOf(questions[idx].correctAnswer);
        const isCorrect = ans.selectedAnswer === questions[idx].correctAnswer;
        if (isCorrect) score++;

        return {
            questionIndex: ans.questionIndex,
            selectedAnswer: ans.selectedAnswer,
            isCorrect,
            correctAnswer: questions[idx].correctAnswer
        };
    });

    const percentage = Math.round((score / questions.length) * 100);

    // ✅ SAVE FULL DATA
    const completedQuiz = {
        quizId,
        fileName: fileName || 'Document Quiz',
        score,
        total: questions.length,
        percentage,
        questions,  // ✅ ALL QUESTIONS
        userAnswers,  // ✅ USER'S ANSWERS
        description: `File Quiz - ${score}/${questions.length} (${percentage}%)`
    };

    // Save to user profile
    const user = await User.findById(userId);
    user.completedQuizzes.push(completedQuiz);
    user.activity.unshift({
        type: 'quiz',
        quizId,
        fileName,
        score,
        total: questions.length,
        percentage,
        description: completedQuiz.description,
        timestamp: new Date()
    });
    await user.save();

    res.json({
        status: 'success',
        score,
        total: questions.length,
        percentage,
        completedQuizId: completedQuiz._id
    });
});


const my = asyncWrapper(async (req, res) => {
    const user = await User.findById(req.user.id).select('activity completedQuizzes');

    if (!user) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // ✅ DEDUPLICATE: Track unique quiz IDs
    const seenQuizIds = new Set();
    const uniqueFileQuizzes = [];

    // Process activity (primary source) - DEDUPLICATED
    user.activity
        .filter(activity =>
            activity.type === 'quiz' &&
            activity.description.includes('quiz_') &&
            !activity.description.includes('Lesson') &&
            !activity.description.includes('Track')
        )
        .forEach(activity => {
            const quizIdMatch = activity.description.match(/quiz_[\w-]+\b/);
            const quizId = quizIdMatch ? quizIdMatch[0] : activity._id.toString();

            if (!seenQuizIds.has(quizId)) {
                seenQuizIds.add(quizId);
                const scoreMatch = activity.description.match(/(\d+)\/(\d+)/);
                uniqueFileQuizzes.push({
                    _id: activity._id.toString(),
                    fileName: activity.fileName || 'Document Quiz',
                    description: activity.description,
                    score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
                    totalQuestions: scoreMatch ? parseInt(scoreMatch[2]) : 0,
                    percentage: scoreMatch ? Math.round((parseInt(scoreMatch[1]) / parseInt(scoreMatch[2])) * 100) : 0,
                    createdAt: activity.timestamp || activity.createdAt,
                    quizId: quizId  // ✅ Track original quiz ID
                });
            }
        });

    // Process completedQuizzes - DEDUPLICATED  
    (user.completedQuizzes || [])
        .filter(q => q.quizId && q.quizId.startsWith('quiz_'))
        .forEach(q => {
            if (!seenQuizIds.has(q.quizId)) {
                seenQuizIds.add(q.quizId);
                uniqueFileQuizzes.push({
                    _id: q._id || q.quizId,
                    fileName: q.fileName || 'Document Quiz',
                    description: `File Quiz - ${q.score}/${q.total} (${q.percentage}%)`,
                    score: q.score || 0,
                    totalQuestions: q.total || 0,
                    percentage: q.percentage || 0,
                    createdAt: q.date,
                    quizId: q.quizId
                });
            }
        });

    // ✅ SORT by date (newest first)
    uniqueFileQuizzes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    console.log(`📋 Unique file quizzes: ${uniqueFileQuizzes.length} (deduplicated from ${seenQuizIds.size})`);

    res.json({
        status: 'success',
        quizzes: uniqueFileQuizzes
    });
});


module.exports = {
    generateQuiz,
    submitQuiz,
    my
};
