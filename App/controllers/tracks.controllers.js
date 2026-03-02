const Track = require("../models/track.model");
const Lesson = require("../models/lesson.model");
const User = require("../models/user.module");
const asyncWrapper = require("../middlewares/asyncWrapper");
const appError = require("../../utils/appError");
const httpStatusText = require("../../utils/httpStatusText");

// Get all tracks (for homepage or track list)
const getAllTracks = asyncWrapper(async (req, res, next) => {
    const tracks = await Track.find().select("-__v").lean();
    if (!tracks || tracks.length === 0) {
        return next(new appError("No tracks found", 404));
    }
    res.json({ status: httpStatusText.SUCCESS, data: { tracks } });
});

// Get a single track with lessons sorted by order + finalQuiz
const getTrackById = asyncWrapper(async (req, res, next) => {
    const { trackId } = req.params;
    const track = await Track.findById(trackId).select("-__v").lean();
    if (!track) return next(new appError("Track not found", 404));

    // Get lessons of this track sorted by order
    const lessons = await Lesson.find({ track: trackId })
        .sort({ order: 1 })
        .select("-__v")
        .lean();

    // If user is logged in, check progress
    let progress = [];
    if (req.user) {
        const user = await User.findById(req.user.id).lean();
        const trackProgress = user.progress.find(
            (p) => p.track.toString() === trackId
        );
        progress = trackProgress?.completedLessons.map((id) => id.toString()) || [];
    }

    // Lock lessons logic
    const lessonsWithAccess = lessons.map((lesson, index) => {
        let locked = false;

        // Only first lesson is unlocked initially
        if (index > 0) {
            // Previous lesson must be completed to unlock
            const prevLessonId = lessons[index - 1]._id.toString();
            if (!progress.includes(prevLessonId)) locked = true;
        }

        return {
            ...lesson,
            locked,
            completed: progress.includes(lesson._id.toString()),
        };
    });

    // Final quiz: sent as a property of the track (don't expose answers)
    let finalQuiz = [];
    if (Array.isArray(track.finalQuiz) && track.finalQuiz.length) {
        // Remove the answers from the quiz when sending to client
        finalQuiz = track.finalQuiz.map(({ question, options }) => ({
            question,
            options
        }));
    }

    res.json({
        status: httpStatusText.SUCCESS,
        data: { 
            track, 
            lessons: lessonsWithAccess,
            finalQuiz
        },
    });
});

const createTrack = asyncWrapper(async (req, res, next) => {
    const { title, description, level, thumbnail, prefInfo, finalQuiz } = req.body;

    if (!title || !description) {
        return next(new appError("Title and description are required", 400));
    }

    // If finalQuiz exists, validate its structure
    let quiz = [];
    if (Array.isArray(finalQuiz) && finalQuiz.length > 0) {
        quiz = finalQuiz.map(q => ({
            question: q.question,
            options: Array.isArray(q.options) ? q.options : [],
            answer: q.answer
        }));
    }

    const track = await Track.create({
        title,
        description,
        level: level || "beginner",
        thumbnail: thumbnail || "",
        prefInfo: prefInfo || { text: [], images: [] },
        finalQuiz: quiz,
        createdBy: req.user.id,
    });

    res.status(201).json({
        status: httpStatusText.SUCCESS,
        data: { track},
    });
});

// Update track (allow updating finalQuiz)
const updateTrack = asyncWrapper(async (req, res, next) => {
    const { trackId } = req.params;
    const updates = { ...req.body };

    // If updating finalQuiz, validate and assign
    if (updates.finalQuiz && Array.isArray(updates.finalQuiz)) {
        updates.finalQuiz = updates.finalQuiz.map(q => ({
            question: q.question,
            options: Array.isArray(q.options) ? q.options : [],
            answer: q.answer
        }));
    }

    const track = await Track.findByIdAndUpdate(trackId, updates, { new: true });

    if (!track) return next(new appError("Track not found", 404));

    res.json({ status: httpStatusText.SUCCESS, data: { track } });
});

// Delete track
const deleteTrack = asyncWrapper(async (req, res, next) => {
    const { trackId } = req.params;

    const track = await Track.findByIdAndDelete(trackId);
    if (!track) return next(new appError("Track not found", 404));

    // Delete all lessons in this track
    await Lesson.deleteMany({ track: trackId });

    res.json({
        status: httpStatusText.SUCCESS,
        message: "Track and its lessons deleted",
    });
});


module.exports = {
    getAllTracks,
    getTrackById,
    createTrack,
    updateTrack,
    deleteTrack,
};