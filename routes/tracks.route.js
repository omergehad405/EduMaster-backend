const express = require("express");
const router = express.Router();
const verifyToken = require("../App/middlewares/verifyToken");
const { getAllTracks, getTrackById, createTrack } = require("../App/controllers/tracks.controllers");

// Public: see all tracks
router.get("/", getAllTracks);

// Private: create a new track
router.post("/", verifyToken, createTrack);

// Private: see single track with lesson access and user progress
router.get("/:trackId", verifyToken, getTrackById);

module.exports = router;