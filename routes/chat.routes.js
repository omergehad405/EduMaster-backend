const express = require("express");
const asyncWrapper = require("../App/middlewares/asyncWrapper");
const appError = require("../utils/appError");

const router = express.Router();

router.post("/", asyncWrapper(async (req, res, next) => {
    if (!process.env.GROQ_API_KEY) {
        return next(new appError("GROQ_API_KEY missing from .env", 500));
    }

    const { message } = req.body;
    if (!message || typeof message !== "string") {
        return next(new appError("message is required", 400));
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: message }],
            max_tokens: 200,
            temperature: 0.7
        })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "No response";

    res.json({ reply });
}));


module.exports = router;
