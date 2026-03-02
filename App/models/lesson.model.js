const mongoose = require("mongoose");

const contentBlockSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["heading", "text", "image", "code"],
      required: true,
    },
    value: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const lessonSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },

    content: {
      type: [contentBlockSchema],
      required: true,
    },

    videoUrl: {
      type: String,
      default: "",
    },

    order: {
      type: Number,
      required: true,
    },

    track: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Track",
      required: true,
    },

    quiz: [
      {
        question: { type: String, required: true },
        options: [{ type: String, required: true }],
        answer: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lesson", lessonSchema);