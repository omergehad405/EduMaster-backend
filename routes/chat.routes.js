const express = require("express");
const asyncWrapper = require("../App/middlewares/asyncWrapper");
const appError = require("../utils/appError");

const router = express.Router();

router.post("/", asyncWrapper(async (req, res, next) => {
    if (!process.env.GROQ_API_KEY) {
        return next(new appError("GROQ_API_KEY missing from .env", 500));
    }

    const { message, fileContext, level } = req.body;
    if (!message || typeof message !== "string") {
        return next(new appError("message is required", 400));
    }

    const systemPrompt = `You are an educational assistant. 
    ${fileContext ? `The student is currently studying a file with this content: ${fileContext.slice(0, 5000)}` : ""}
    ${level ? `The student's current learning level is ${level}. Adapt your explanations to be suitable for this level.` : ""}
    LANGUAGE RULE: Always respond in the SAME LANGUAGE as the student's message or the provided file context.
    Answer concisely and clearly.`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ],
            max_tokens: 500,
            temperature: 0.7
        })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "No response";

    res.json({ reply });
}));


module.exports = router;
