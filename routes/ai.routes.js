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

        const { message } = req.body;
        const file = req.file;

        if ((!message || typeof message !== "string") && !file) {
            return next(new appError("message or file is required", 400));
        }

        // Build full prompt
        let fullPrompt = message || "Analyze this content: ";

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

                if (!pdfText.trim()) {
                    return next(new appError("Could not extract text from PDF", 400));
                }

                fullPrompt += `\n\n[PDF CONTENT]\n${pdfText.slice(0, 8000)}`;

            } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.originalname.endsWith(".docx")) {
                const result = await mammoth.extractRawText({ path: file.path });
                const wordText = result.value;
                if (!wordText.trim()) return next(new appError("Word file is empty", 400));
                fullPrompt += `\n\n[WORD FILE CONTENT]\n${wordText.slice(0, 8000)}`;

            } else {
                // Try reading as generic text
                try {
                    const txt = fs.readFileSync(file.path, "utf8").trim();
                    if (!txt) return next(new appError("File is empty", 400));
                    fullPrompt += `\n\n[FILE CONTENT]\n${txt.slice(0, 8000)}`;
                } catch (err) {
                    console.error("❌ Generic extraction failed:", err);
                    return next(new appError("Failed to read this file format as text", 400));
                }
            }
        }

        // ✅ GROQ API - Lightning fast & FREE
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: fullPrompt }],
                max_tokens: 500,
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
