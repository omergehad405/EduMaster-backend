const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFParser = require("pdf2json");
const mammoth = require("mammoth");
const upload = require("../App/middlewares/upload");
const asyncWrapper = require("../App/middlewares/asyncWrapper");
const appError = require("../utils/appError");

const router = express.Router();

const requireSiteKey = (req, res, next) => {
    const expected = process.env.SITE_API_KEY;
    if (!expected) return next();
    const provided = req.headers["x-site-key"];
    if (!provided || provided !== expected) {
        return next(new appError("Unauthorized", 401));
    }
    return next();
};

router.post(
    "/solve",
    requireSiteKey,
    upload.single("file"),
    asyncWrapper(async (req, res, next) => {
        if (!process.env.GROQ_API_KEY) {
            return next(new appError("GROQ_API_KEY missing from .env", 500));
        }

        const { message, difficulty = "medium" } = req.body;
        const file = req.file;

        if ((!message || typeof message !== "string") && !file) {
            return next(new appError("message or file is required", 400));
        }

        // Build full prompt
        let contentText = "";

        if (file) {
            if (file.mimetype === "application/pdf") {
                const buffer = fs.readFileSync(file.path);
                const pdfParser = new PDFParser();

                const pdfText = await new Promise((resolve, reject) => {
                    pdfParser.on("pdfParser_dataError", (err) => reject(err));
                    pdfParser.on("pdfParser_dataReady", (pdfData) => {
                        let text = "";
                        if (pdfData.Pages && pdfData.Pages.length > 0) {
                            text = pdfData.Pages
                                .map(page =>
                                    page.Texts
                                        ?.map(t => {
                                            if (!t.R?.[0]?.T) return "";
                                            try { return decodeURIComponent(t.R[0].T); }
                                            catch { return t.R[0].T; }
                                        })
                                        .filter(Boolean)
                                        .join(" ")
                                )
                                .filter(Boolean)
                                .join("\n\n");
                        }
                        resolve(text);
                    });
                    pdfParser.parseBuffer(buffer);
                });

                if (pdfText.trim()) contentText = pdfText.slice(0, 8000);

            } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.originalname.endsWith(".docx")) {
                const result = await mammoth.extractRawText({ path: file.path });
                contentText = result.value.slice(0, 8000);
            } else {
                try {
                    contentText = fs.readFileSync(file.path, "utf8").slice(0, 8000);
                } catch (err) {}
            }
        }

        const systemMessage = `You are a helpful educational AI assistant. 
        The student is at a ${difficulty.toUpperCase()} level. 
        Adapt your explanations and language to be appropriate for this level.
        ${contentText ? `\n\nCONTEXT FROM UPLOADED FILE:\n${contentText}` : ""}`;

        // ✅ GROQ API - Lightning fast & FREE
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemMessage },
                    { role: "user", content: message || "Analyze the attached content." }
                ],
                max_tokens: 800,
                temperature: 0.7
            })
        });

        const data = await response.json();

        let reply;
        if (response.ok && data.choices?.[0]?.message?.content) {
            reply = data.choices[0].message.content.trim();
        } else {
            reply = "Service temporarily unavailable";
            console.error("Groq Error:", data);
        }

        const uploaded = file ? {
            filename: file.filename,
            mimetype: file.mimetype,
            size: file.size,
            url: `/uploads/${path.basename(file.path)}`
        } : null;

        res.json({ reply, file: uploaded });
    })
);

module.exports = router;
