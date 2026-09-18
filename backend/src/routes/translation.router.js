import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { translate } from "../controllers/translation.controller.js";

const router = express.Router();
router.post("/", protect, translate);

export default router;