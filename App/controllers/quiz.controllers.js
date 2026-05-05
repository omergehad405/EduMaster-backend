// App/controllers/quiz.controllers.js
const fs = require('fs');
const PDFParser = require('pdf2json');
const mammoth = require('mammoth');
const appError = require("../../utils/appError");
const asyncWrapper = require("../middlewares/asyncWrapper");
const User = require("../models/user.module");

// ─────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────

/** Extract plain text from the uploaded file */
async function extractContent(file) {
    if (!file) throw new Error('No file provided');

    if (file.mimetype === 'application/pdf') {
        const buffer = fs.readFileSync(file.path);
        const pdfParser = new PDFParser();
        return new Promise((resolve, reject) => {
            pdfParser.on('pdfParser_dataReady', (pdfData) => {
                const text = pdfData.Pages?.map(page =>
                    page.Texts?.map(t => {
                        const raw = t.R?.[0]?.T || '';
                        try { return decodeURIComponent(raw); } catch { return raw; }
                    }).join(' ')
                ).join('\n\n') || '';
                resolve(text.slice(0, 15000));
            });
            pdfParser.on('pdfParser_dataError', (err) => {
                console.error('❌ PDF parse error:', err);
                reject(new Error('PDF parsing failed'));
            });
            pdfParser.parseBuffer(buffer);
        });
    }

    if (
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.originalname.endsWith('.docx')
    ) {
        const result = await mammoth.extractRawText({ path: file.path });
        return result.value.slice(0, 15000);
    }

    return fs.readFileSync(file.path, 'utf8').slice(0, 15000);
}

/** Call Groq and return raw text response */
async function callGroq(prompt, maxTokens = 3000, temperature = 0.7) {
    const models = [
        'llama-3.3-70b-versatile',          // الأحسن جودة
        'llama-3.1-8b-instant',             // أسرع وأخف
        'meta-llama/llama-4-scout-17b-16e-instruct',  // fallback 2
        'meta-llama/llama-4-maverick-17b-128e-instruct' // fallback 3
    ];

    for (const model of models) {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: maxTokens,
                temperature
            })
        });

        const data = await res.json();

        // لو rate limit → جرب الموديل الجاي
        if (!res.ok && data.error?.code === 'rate_limit_exceeded') {
            console.warn(`⚠️ Model ${model} rate limited, trying next...`);
            continue;
        }

        if (!res.ok) throw new Error(`Groq error: ${data.error?.message}`);

        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error('Groq returned empty content');

        return text;
    }

    throw new Error('All Groq models are rate limited. Please try again later.');
}

/**
 * Detect the language of the content with a dedicated Groq call.
 * Returns a string like "Arabic", "English", "French", etc.
 */
async function detectLanguage(content) {
    const sample = content.slice(0, 1500);
    const prompt = `Identify the language of the following text.
Reply with ONLY the language name in English (e.g., "Arabic", "English", "French", "Spanish", "German").
Do NOT add any explanation, punctuation, or extra words.

TEXT:
${sample}`;

    try {
        const raw = await callGroq(prompt, 20, 0);
        const lang = raw.split(/[\n,.(]/)[0].trim();
        return lang;
    } catch (err) {
        return 'English';
    }
}

/** Strip markdown code fences and parse JSON safely */
function parseJSON(raw) {
    const clean = raw
        .replace(/```json|```javascript|```/gi, '')
        .trim();

    // Find first '[' and last ']' to extract only the JSON array
    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');

    if (start === -1 || end === -1) {
        console.error('❌ No JSON array found in response. Raw:', clean.slice(0, 300));
        throw new Error('No valid JSON array found in AI response');
    }

    const jsonStr = clean.slice(start, end + 1);

    try {
        return JSON.parse(jsonStr);
    } catch (err) {
        console.error('❌ JSON.parse failed. String was:', jsonStr.slice(0, 300));
        throw new Error(`JSON parse error: ${err.message}`);
    }
}

// ─────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────

const generateQuiz = asyncWrapper(async (req, res, next) => {
    const { type = 'mcq', time = 30, count = 5, difficulty = 'medium' } = req.body;
    const file = req.file;

    if (!process.env.GROQ_API_KEY) {
        return next(new appError('GROQ_API_KEY is not configured', 500));
    }

    if (!file) return next(new appError('File required', 400));

    // 1. Extract text
    let content;
    try {
        content = await extractContent(file);
    } catch (err) {
        console.error('❌ Content extraction failed:', err.message);
        return next(new appError(`Failed to extract text from file: ${err.message}`, 400));
    }

    if (!content.trim()) {
        return next(new appError('No text could be extracted from this file', 400));
    }

    // 2. Detect language (dedicated call — reliable)
    const language = await detectLanguage(content);

    // 3. Build quiz prompt with language injected as hard constraint
    const typeInstruction = type === 'tf'
        ? `Generate TRUE/FALSE questions. The two options must be the words for "True" and "False" written in ${language}.`
        : `Generate MCQ questions. Each question must have EXACTLY 4 options formatted as ["A) text", "B) text", "C) text", "D) text"].`;

    const prompt = `You are a professional quiz generator.

DETECTED LANGUAGE: ${language}
ABSOLUTE REQUIREMENT: Every single word of your response — questions, options, correctAnswer, explanation — MUST be written in ${language}. No exceptions. Do NOT switch to any other language under any circumstances.

Generate EXACTLY ${count} UNIQUE ${difficulty.toUpperCase()} difficulty quiz questions based ONLY on the TEXT below.

Difficulty guide:
- Easy: Basic facts and recall
- Medium: Application and understanding  
- Hard: Analysis and synthesis

${typeInstruction}

TEXT:
${content.slice(0, 10000)}

RETURN ONLY a valid JSON array. No preamble, no explanation, no markdown fences, no extra text before or after.

JSON FORMAT:
[
  {
    "question": "...",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "correctAnswer": "A) ...",
    "explanation": "...",
    "difficulty": "${difficulty}"
  }
]`;

    // 4. Generate questions
    let questions;
    try {
        const raw = await callGroq(prompt, 3000, 0.7);
        questions = parseJSON(raw);
    } catch (err) {
        console.error('❌ Quiz generation/parse failed:', err.message);
        return next(new appError(`Failed to generate quiz: ${err.message}`, 500));
    }

    const quizId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    res.json({
        success: true,
        quizId,
        questions: questions.slice(0, parseInt(count)),
        type,
        time: parseInt(time),
        count: parseInt(count),
        difficulty,
        language
    });
});

// ─────────────────────────────────────────────

const generateAssessment = asyncWrapper(async (req, res, next) => {
    const file = req.file;

    if (!process.env.GROQ_API_KEY) {
        return next(new appError('GROQ_API_KEY is not configured', 500));
    }

    if (!file) return next(new appError('File required', 400));

    // 1. Extract text
    let content;
    try {
        content = await extractContent(file);
    } catch (err) {
        console.error('❌ Content extraction failed:', err.message);
        return next(new appError(`Failed to extract text from file: ${err.message}`, 400));
    }

    if (!content.trim()) {
        return next(new appError('No text could be extracted from this file', 400));
    }

    // 2. Detect language
    const language = await detectLanguage(content);

    // 3. Build assessment prompt
    const prompt = `You are a level assessment evaluator.

DETECTED LANGUAGE: ${language}
ABSOLUTE REQUIREMENT: Every single word of your response — questions, options, correctAnswer, explanation — MUST be written in ${language}. No exceptions. Do NOT switch to any other language under any circumstances.

Generate EXACTLY 15 UNIQUE quiz questions from the TEXT below for a Level Assessment.
The 15 questions MUST be split exactly as follows:
- 5 questions with "difficulty": "easy"   (Simple recall)
- 5 questions with "difficulty": "medium" (Understanding and application)
- 5 questions with "difficulty": "hard"   (Analysis and synthesis)

Each question must have EXACTLY 4 options formatted as ["A) text", "B) text", "C) text", "D) text"].

TEXT:
${content.slice(0, 8000)}

RETURN ONLY a valid JSON array of exactly 15 objects. No preamble, no explanation, no markdown fences, no extra text before or after.

JSON FORMAT:
[
  {
    "question": "...",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "correctAnswer": "A) ...",
    "explanation": "...",
    "difficulty": "easy"
  }
]`;

    // 4. Generate questions
    let questions;
    try {
        const raw = await callGroq(prompt, 4000, 0.6);
        questions = parseJSON(raw);
    } catch (err) {
        console.error('❌ Assessment generation/parse failed:', err.message);
        return next(new appError(`Failed to generate assessment: ${err.message}`, 500));
    }

    // Validate we have questions for all 3 difficulty levels
    const easy = questions.filter(q => q.difficulty === 'easy');
    const medium = questions.filter(q => q.difficulty === 'medium');
    const hard = questions.filter(q => q.difficulty === 'hard');

    if (easy.length === 0 || medium.length === 0 || hard.length === 0) {
        console.error('⚠️ Missing difficulty levels — easy:', easy.length, 'medium:', medium.length, 'hard:', hard.length);
    }

    res.json({
        success: true,
        questions,
        total: questions.length,
        language,
        breakdown: {
            easy: easy.length,
            medium: medium.length,
            hard: hard.length
        }
    });
});

// ─────────────────────────────────────────────

const submitQuiz = asyncWrapper(async (req, res, next) => {
    const { quizId, answers, questions, fileName } = req.body;
    const userId = req.user.id;

    if (!answers || !questions || answers.length === 0 || questions.length === 0) {
        return next(new appError('answers and questions are required', 400));
    }

    let score = 0;
    const userAnswers = answers.map((ans, idx) => {
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

    const completedQuiz = {
        quizId,
        fileName: fileName || 'Document Quiz',
        score,
        total: questions.length,
        percentage,
        questions,
        userAnswers,
        description: `File Quiz - ${score}/${questions.length} (${percentage}%)`
    };

    const user = await User.findById(userId);
    if (!user) return next(new appError('User not found', 404));

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

// ─────────────────────────────────────────────

const my = asyncWrapper(async (req, res) => {
    const user = await User.findById(req.user.id).select('activity completedQuizzes');
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    const seenQuizIds = new Set();
    const uniqueFileQuizzes = [];

    // From activity
    user.activity
        .filter(a =>
            a.type === 'quiz' &&
            a.description?.includes('quiz_') &&
            !a.description?.includes('Lesson') &&
            !a.description?.includes('Track')
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
                    percentage: scoreMatch
                        ? Math.round((parseInt(scoreMatch[1]) / parseInt(scoreMatch[2])) * 100)
                        : 0,
                    createdAt: activity.timestamp || activity.createdAt,
                    quizId
                });
            }
        });

    // From completedQuizzes
    (user.completedQuizzes || [])
        .filter(q => q.quizId?.startsWith('quiz_'))
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

    uniqueFileQuizzes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ status: 'success', quizzes: uniqueFileQuizzes });
});

// ─────────────────────────────────────────────

module.exports = { generateQuiz, generateAssessment, submitQuiz, my };