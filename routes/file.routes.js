const express = require("express");
const upload = require("../App/middlewares/upload");
const appError = require("../utils/appError");

const router = express.Router();

router.post("/upload", upload.single("file"), (req, res, next) => {
    if (!req.file) {
        return next(new appError("file is required", 400));
    }

    const relativePath = `/uploads/${req.file.filename}`;

    res.status(201).json({
        file: {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            size: req.file.size,
            url: relativePath,
        },
    });
});

module.exports = router;
