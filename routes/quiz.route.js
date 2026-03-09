// routes/quizzes.js - FULL ROUTER
const express = require("express");
const router = express.Router();
const upload = require("../App/middlewares/upload");
const quizController = require("../App/controllers/quiz.controllers");
const verifyToken = require("../App/middlewares/verifyToken");
const asyncWrapper = require("../App/middlewares/asyncWrapper");
const User = require("../App/models/user.module");

router.post('/generate', upload.single('file'), quizController.generateQuiz);
router.post('/submit', verifyToken, quizController.submitQuiz);
router.get('/my', verifyToken, quizController.my);
router.get('/completed/:completedId', verifyToken, asyncWrapper(async (req, res) => {
    const { completedId } = req.params;

    console.log('🔍 Searching for quiz:', completedId);

    const user = await User.findById(req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    // ✅ SEARCH EVERYWHERE for the quiz
    let quizData = null;

    // 1. Check completedQuizzes by ID or quizId
    quizData = user.completedQuizzes.find(q =>
        q._id?.toString() === completedId ||
        q.quizId === completedId ||
        completedId.includes(q.quizId || '')
    );

    // 2. Check activity by ID or quizId
    if (!quizData) {
        const activity = user.activity.find(a =>
            a._id?.toString() === completedId ||
            a.quizId === completedId ||
            a.description?.includes(completedId)
        );

        if (activity) {
            quizData = {
                fileName: activity.fileName || 'Document Quiz',
                score: activity.score || 0,
                totalQuestions: activity.totalQuestions || 0,
                percentage: activity.percentage || 0,
                description: activity.description,
                questions: [], // No questions stored in activity
                userAnswers: []
            };
        }
    }

    if (!quizData) {
        console.log('❌ Quiz not found in:', {
            completedQuizzes: user.completedQuizzes.length,
            activity: user.activity.length
        });
        return res.status(404).json({ error: 'Quiz not found' });
    }

    // ✅ Format response for frontend
    const response = {
        fileName: quizData.fileName,
        score: quizData.score || 0,
        totalQuestions: quizData.totalQuestions || quizData.questions?.length || 0,
        percentage: quizData.percentage || 0,
        description: quizData.description || `${quizData.score}/${quizData.totalQuestions}`,
        questions: quizData.questions || [],
        userAnswers: quizData.userAnswers || []
    };

    console.log('✅ Quiz review served:', {
        id: completedId,
        fileName: response.fileName,
        score: response.score,
        hasQuestions: response.questions.length > 0
    });

    res.json(response);
}));

module.exports = router;
