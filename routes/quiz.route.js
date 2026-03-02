const express = require("express")
const router = express.Router()
const fs = require('fs');
const PDFParser = require('pdf2json');
const upload = require("../App/middlewares/upload")
const asyncWrapper = require("../App/middlewares/asyncWrapper")
const appError = require("../utils/appError")

router.post('/generate', upload.single('file'), asyncWrapper(async (req, res, next) => {
    const { type = 'mcq', time = 30, count = 5 } = req.body;
    const file = req.file;

    console.log('🎯 QUIZ GENERATION STARTED:', { type, time, count, file: file?.originalname });

    if (!file) return next(new appError('File required', 400));

    // Extract content
    let content = '';
    try {
        if (file.mimetype === 'application/pdf') {
            const buffer = fs.readFileSync(file.path);
            const pdfParser = new PDFParser();

            content = await new Promise((resolve, reject) => {  // ✅ FIXED: Added reject
                pdfParser.on('pdfParser_dataReady', (pdfData) => {
                    const text = pdfData.Pages?.map(page =>
                        page.Texts?.map(t => decodeURIComponent(t.R?.[0]?.T || '')).join(' ')
                    ).join('\n\n') || '';
                    console.log('✅ PDF extracted:', text.slice(0, 200));
                    resolve(text.slice(0, 15000));
                });
                pdfParser.on('pdfParser_dataError', (err) => {
                    console.error('❌ PDF Parse Error:', err);
                    resolve('');  // ✅ Return empty instead of reject
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
            model: 'llama-3.3-70b-versatile',  // ✅ CURRENT 2026 model
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
}));

module.exports = router
