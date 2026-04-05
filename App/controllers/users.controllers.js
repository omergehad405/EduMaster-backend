const User = require("../models/user.module")
const Track = require("../models/track.model")
const Lesson = require("../models/lesson.model")

const httpStatusText = require("../../utils/httpStatusText")
const appError = require("../../utils/appError")
const asyncWrapper = require("../middlewares/asyncWrapper")
const bcrypt = require("bcrypt")
const generateJWT = require("../../utils/generateJWT")

const addXP = (user, amount) => {
    const today = new Date().toISOString().split('T')[0];

    if (!user.dailyXP) user.dailyXP = { amount: 0 };
    if (user.dailyXP.date !== today) {
        user.dailyXP.date = today;
        user.dailyXP.amount = 0;
    }

    const XP_CAP = 200;
    const remainingXP = Math.max(0, XP_CAP - user.dailyXP.amount);
    if (remainingXP === 0) return 0;

    const xpToAdd = Math.min(amount, remainingXP);
    user.xp = (user.xp || 0) + xpToAdd;
    user.dailyXP.amount += xpToAdd;
    return xpToAdd;
};

const updateStreak = (user) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const today = new Date(todayStr);

    if (!user.streak) user.streak = { current: 0 };

    if (!user.streak.lastLogin) {
        // First ever login
        user.streak.current = 1;
        user.streak.lastLogin = today;
        addXP(user, 5); // daily login XP
        return;
    }

    const lastLoginDate = new Date(user.streak.lastLogin);
    const diffTime = Math.abs(today - lastLoginDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
        // consecutive day
        user.streak.current += 1;
        user.streak.lastLogin = today;
        addXP(user, 5); // daily login XP

        if (user.streak.current === 7) {
            addXP(user, 20); // 7 day bonus
        } else if (user.streak.current === 30) {
            addXP(user, 100); // 30 day bonus
        }
    } else if (diffDays > 1) {
        // streak broken
        user.streak.current = 1;
        user.streak.lastLogin = today;
        addXP(user, 5); // daily login XP
    }
};

const getAllUsers = asyncWrapper(async (req, res, next) => {
    const users = await User.find({}, { __v: false, password: false })

    if (!users) {
        return next(new appError("users not found", 404))
    }

    res.json({ status: httpStatusText.SUCCESS, data: { users } })
})

const register = asyncWrapper(async (req, res, next) => {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password) {
        return next(new appError("All fields are required", 400));
    }

    const oldUser = await User.findOne({ email });
    if (oldUser) return next(new appError("User already exists", 400));

    const hashedPassword = await bcrypt.hash(password, 10);

    //"passowrd" => $password
    // Save avatar path if file uploaded
    const avatarUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const newUser = await User.create({
        username,
        email,
        password: hashedPassword,
        avatar: avatarUrl,
        role
    });

    const token = generateJWT({
        id: newUser._id,
        email: newUser.email,
        role: newUser.role,
    });

    const { password: _, ...userData } = newUser.toObject();

    res.status(201).json({
        status: "success",
        data: { token, user: userData },
    });
});

const login = asyncWrapper(async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return next(new appError("Email and password are required", 400));
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
        return next(new appError("Invalid email or password", 400));
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        return next(new appError("Invalid email or password", 400));
    }

    const token = generateJWT({
        id: user._id,
        email: user.email,
        role: user.role,
    });

    const { password: _, ...userData } = user.toObject();

    res.status(200).json({
        status: httpStatusText.SUCCESS,
        data: { token, user: userData },
    });
});

const getMe = asyncWrapper(async (req, res, next) => {
    console.log("🔍 getMe called with user:", req.user?.id); // ✅ DEBUG

    const user = await User.findById(req.user.id).select('-password -__v');

    if (!user) {
        return next(new appError("User not found", 404));
    }

    updateStreak(user);
    await user.save();

    console.log("✅ Returning user:", user.username); // ✅ DEBUG
    res.json({
        status: httpStatusText.SUCCESS,
        data: { user }
    });
});

const enrollInTrack = asyncWrapper(async (req, res, next) => {
    const { trackId } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return next(new appError("User not found", 404));

    const track = await Track.findById(trackId);
    if (!track) return next(new appError("Track not found", 404));

    const alreadyEnrolled = user.enrolledTracks.some(
        (id) => id.toString() === trackId
    );
    if (alreadyEnrolled) {
        return next(new appError("Already enrolled", 400));
    }

    // Enroll the user
    user.enrolledTracks.push(trackId);

    // Initialize progress for this track
    // First lesson unlocked automatically (frontend checks for completedLessons)
    const firstLesson = await Lesson.find({ track: trackId }).sort({ order: 1 }).limit(1);
    const completedLessons = [];
    if (firstLesson.length) {
        // Optionally, you could mark firstLesson[0] as unlocked in frontend only
        // We just leave it empty in DB; locking logic is frontend controlled
    }

    user.progress.push({
        track: trackId,
        completedLessons: completedLessons,
    });

    // Add track enrollment activity to user.activity
    user.activity.push({
        type: 'track',
        refId: track._id,
        description: `Enrolled in track ${track.title}`,
        timestamp: new Date()
    });

    await user.save();

    res.json({
        status: httpStatusText.SUCCESS,
        message: "Enrolled successfully",
        enrolledTracks: user.enrolledTracks,
        progress: user.progress,
    });
});

const completeLesson = asyncWrapper(async (req, res, next) => {
    const { lessonId, trackId } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return next(new appError("User not found", 404));

    // Find or create progress for this track
    let trackProgress = user.progress.find(
        (p) => p.track.toString() === trackId
    );

    if (!trackProgress) {
        trackProgress = { track: trackId, completedLessons: [] };
        user.progress.push(trackProgress);
    }

    // Add lesson if not already completed
    if (!trackProgress.completedLessons.includes(lessonId)) {
        trackProgress.completedLessons.push(lessonId);
        addXP(user, 20); // Lesson complete XP

        // Fetch lesson for activity logging
        const lesson = await Lesson.findById(lessonId);
        if (lesson) {
            user.activity.push({
                type: 'lesson',
                refId: lesson._id,
                description: `Completed lesson ${lesson.title}`,
                timestamp: new Date()
            });
        }
    }

    // Check if all lessons are completed
    const lessonsCount = await Lesson.countDocuments({ track: trackId });
    if (trackProgress.completedLessons.length === lessonsCount) {
        if (!user.completedTracks.includes(trackId)) {
            user.completedTracks.push(trackId);
            addXP(user, 100); // Track complete XP
        }
    }

    await user.save();

    res.json({
        status: httpStatusText.SUCCESS,
        message: "Lesson completed",
        completedTracks: user.completedTracks,
    });
});

const updateAvatar = asyncWrapper(async (req, res, next) => {
    if (!req.file) {
        return next(new appError("No image uploaded", 400));
    }

    const user = await User.findById(req.user.id);
    if (!user) {
        return next(new appError("User not found", 404));
    }

    user.avatar = req.file.path;

    // Log activity
    user.activity.push({
        type: 'avatar',
        refId: user._id,
        description: `Updated avatar`,
        timestamp: new Date()
    });

    await user.save();

    res.json({
        status: httpStatusText.SUCCESS,
        data: { avatar: user.avatar },
    });
})

const completeQuiz = asyncWrapper(async (req, res, next) => {
    const { lessonId, trackId } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return next(new appError("User not found", 404));

    let trackProgress = user.progress.find(p => p.track.toString() === trackId);
    if (!trackProgress) {
        trackProgress = { track: trackId, completedLessons: [] };
        user.progress.push(trackProgress);
    }

    if (!trackProgress.completedLessons.includes(lessonId)) {
        trackProgress.completedLessons.push(lessonId);
        addXP(user, 15); // Quiz complete XP (assumes this endpoint means answering a quiz)

        const lesson = await Lesson.findById(lessonId);
        if (lesson) {
            user.activity.push({
                type: 'quiz',
                refId: lesson._id,
                description: `Completed quiz for lesson ${lesson.title}`,
                timestamp: new Date(),
            });
        }
    }

    const lessonsInTrack = await Lesson.find({ track: trackId }).sort({ order: 1 }).select('_id');
    const currentIndex = lessonsInTrack.findIndex(l => l._id.toString() === lessonId);
    const nextLesson = lessonsInTrack[currentIndex + 1];

    await user.save();

    res.json({
        status: "success",
        message: "Quiz completed, next lesson unlocked",
        nextLessonId: nextLesson?._id || null,
    });
});

const completeFinalQuiz = asyncWrapper(async (req, res, next) => {
    const { trackId, answers } = req.body; // answers from frontend

    const user = await User.findById(req.user.id);
    if (!user) return next(new appError("User not found", 404));

    const track = await Track.findById(trackId);
    if (!track) return next(new appError("Track not found", 404));

    if (!Array.isArray(track.finalQuiz) || !track.finalQuiz.length) {
        return next(new appError("No final quiz for this track", 400));
    }

    // Check answers
    const isAllCorrect = track.finalQuiz.every((q, idx) => {
        return answers[idx] === q.answer;
    });

    if (!isAllCorrect) {
        return res.status(200).json({
            status: "failed",
            message: "Some answers are incorrect. Try again!",
        });
    }

    // Mark all lessons as completed
    let trackProgress = user.progress.find(p => p.track.toString() === trackId);
    const allLessonIds = await Lesson.find({ track: trackId }).select('_id');

    if (!trackProgress) {
        trackProgress = { track: trackId, completedLessons: allLessonIds.map(l => l._id) };
        user.progress.push(trackProgress);
    } else {
        const existingIds = new Set(trackProgress.completedLessons.map(id => id.toString()));
        allLessonIds.forEach(l => {
            if (!existingIds.has(l._id.toString())) trackProgress.completedLessons.push(l._id);
        });
    }

    // Add to completedTracks if not already
    if (!user.completedTracks.includes(trackId)) {
        user.completedTracks.push(trackId);
        addXP(user, 100); // Track complete XP
    }

    // Add final quiz uniqueness XP check
    if (!user.completedTrackQuizzes.includes(trackId)) {
        user.completedTrackQuizzes.push(trackId);
        addXP(user, 30); // Final track quiz complete XP
    }

    // Log activity
    user.activity.push({
        type: "track",
        refId: track._id,
        description: `Completed final quiz for track ${track.title}`,
        timestamp: new Date(),
    });

    await user.save();

    res.json({
        status: "success",
        message: "Final quiz completed! Track marked as completed 🎉",
        completedTracks: user.completedTracks,
        progress: user.progress,
    });
});

const enterLesson = asyncWrapper(async (req, res, next) => {
    const { lessonId } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return next(new appError("User not found", 404));

    if (!user.enteredLessons.includes(lessonId)) {
        user.enteredLessons.push(lessonId);
        addXP(user, 5); // XP for entering a lesson
        await user.save();
    }

    res.json({
        status: "success",
        message: "Lesson entered",
        xp: user.xp
    });
});

module.exports = {
    getAllUsers,
    register,
    login,
    getMe,
    enrollInTrack,
    completeLesson,
    updateAvatar,
    completeQuiz,
    completeFinalQuiz,
    enterLesson
};