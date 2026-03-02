const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Make sure the folder exists
const uploadDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure disk storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir); // save files in uploads folder
    },
    filename: function (req, file, cb) {
        // unique filename: timestamp + original name
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + "-" + uniqueSuffix + ext);
    },
});

// Accept common files (images / pdf / text)
const fileFilter = (req, file, cb) => {
    const allowed = [
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/webp",
        "application/pdf",
        "text/plain",
    ];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Invalid file type."), false);
    }
};

const upload = multer({ storage, fileFilter });

module.exports = upload;