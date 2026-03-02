const express = require("express");
const router = express.Router();
const verifyToken = require("../App/middlewares/verifyToken");
const allowTo = require("../App/middlewares/allowTo");
const roles = require("../utils/roles");

const {
    createTrack,
    updateTrack,
    deleteTrack,
} = require("../App/controllers/tracks.controllers");

const {
    createLesson,
    updateLesson,
    deleteLesson,
} = require("../App/controllers/lesson.controllers");

// Protect all admin routes
router.use(verifyToken, allowTo(roles.ADMIN));

// Track management
router.post("/tracks", createTrack);
router.put("/tracks/:trackId", updateTrack);
router.delete("/tracks/:trackId", deleteTrack);

// Lesson management
router.post("/lessons", createLesson);
router.put("/lessons/:lessonId", updateLesson);
router.delete("/lessons/:lessonId", deleteLesson);

module.exports = router;