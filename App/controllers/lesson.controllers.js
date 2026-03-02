const Lesson = require("../models/lesson.model");
const Track = require("../models/track.model");
const asyncWrapper = require("../middlewares/asyncWrapper");
const appError = require("../../utils/appError");
const httpStatusText = require("../../utils/httpStatusText");

// Create lesson
const createLesson = asyncWrapper(async (req, res, next) => {
    const { title, content, videoUrl, order, track: trackId, quiz } = req.body;

    if (!title || !Array.isArray(content) || content.length === 0 || !trackId || order === undefined) {
        return next(new appError("Missing or invalid required fields", 400));
    }

    const lesson = await Lesson.create({
        title,
        content,
        videoUrl,
        order,
        track: trackId,
        quiz: quiz || [],
    });

    const lessonsCount = await Lesson.countDocuments({ track: trackId });

    await Track.findByIdAndUpdate(trackId, {
        lessonsCount,
    });

    res.status(201).json({
        status: httpStatusText.SUCCESS,
        data: { lesson },
    });
});

// Update lesson
const updateLesson = asyncWrapper(async (req, res, next) => {
    const { lessonId } = req.params;
    const updates = req.body;

    if (updates.content && (!Array.isArray(updates.content) || updates.content.length === 0)) {
        return next(new appError("Content must be a non-empty array", 400));
    }

    const lesson = await Lesson.findByIdAndUpdate(lessonId, updates, { new: true });

    if (!lesson) return next(new appError("Lesson not found", 404));

    res.json({
        status: httpStatusText.SUCCESS,
        data: { lesson },
    });
});

// Delete lesson
const deleteLesson = asyncWrapper(async (req, res, next) => {
    const { lessonId } = req.params;

    const lesson = await Lesson.findByIdAndDelete(lessonId);
    if (!lesson) return next(new appError("Lesson not found", 404));

    const lessonsCount = await Lesson.countDocuments({ track: lesson.track });

    await Track.findByIdAndUpdate(lesson.track, {
        lessonsCount,
    });

    res.json({
        status: httpStatusText.SUCCESS,
        message: "Lesson deleted",
    });
});

module.exports = {
    createLesson,
    updateLesson,
    deleteLesson,
};