const mongoose = require("mongoose");

const trackSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true },
        prefInfo: { text: [String], images: [String] },
        thumbnail: { type: String, default: "" },
        level: { type: String, enum: ["beginner", "intermediate", "advanced"], default: "beginner" },
        lessonsCount: { type: Number, default: 0 },
        studentsCount: { type: Number, default: 0 },

        // ADD THIS
        lessons: [{ type: mongoose.Schema.Types.ObjectId, ref: "Lesson" }],

        finalQuiz: [
            {
                question: { type: String, required: true },
                options: [{ type: String, required: true }],
                answer: { type: String, required: true },
            },
        ],
        isPublished: { type: Boolean, default: false },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Track", trackSchema);