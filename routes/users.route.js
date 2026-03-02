const express = require("express");
const router = express.Router();

const {
    getAllUsers,
    register,
    login,
    enrollInTrack,
    getMe,
    completeLesson,
    updateAvatar,
    completeQuiz,
    completeFinalQuiz,
    enterLesson
} = require("../App/controllers/users.controllers");

const verifyToken = require("../App/middlewares/verifyToken");
const upload = require("../App/middlewares/upload");

router.get("/", getAllUsers);

router.post("/register", upload.single("avatar"), register);

router.post("/login", login);

router.get("/me", verifyToken, getMe);

router.post("/enroll", verifyToken, enrollInTrack);

router.post("/complete-lesson", verifyToken, completeLesson);

router.post('/complete-quiz', verifyToken, completeQuiz);

router.post('/complete-final-quiz', verifyToken, completeFinalQuiz);

router.post('/enter-lesson', verifyToken, enterLesson);

router.post(
    "/upload-avatar",
    verifyToken,
    upload.single("avatar"),
    updateAvatar
);

module.exports = router;