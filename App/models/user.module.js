const mongoose = require("mongoose");
const userRoles = require("../../utils/roles");

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            trim: true,
            minlength: 3,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        password: {
            type: String,
            required: true,
            select: false,
        },
        avatar: {
            type: String,
        },

        role: {
            type: String,
            enum: [userRoles.USER, userRoles.ADMIN, userRoles.MANAGER],
            default: userRoles.USER,
        },
        enrolledTracks: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Track",
            },
        ],
        progress: [
            {
                track: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Track",
                },
                completedLessons: [
                    {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: "Lesson",
                    },
                ],
            },
        ],
        completedTracks: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Track",
            },
        ],
        activity: [
            {
                type: { type: String, enum: ['lesson', 'track', 'quiz', 'upload'], required: true },
                refId: { type: mongoose.Schema.Types.ObjectId },
                description: String,
                timestamp: { type: Date, default: Date.now }
            }
        ],
        xp: { type: Number, default: 0 },
        streak: {
            current: { type: Number, default: 0 },
            lastLogin: { type: Date }
        },
        dailyXP: {
            date: { type: String },
            amount: { type: Number, default: 0 }
        },
        completedTrackQuizzes: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Track",
            },
        ],
        enteredLessons: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Lesson",
            }
        ]
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);