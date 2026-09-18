import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import authRouter from "./routes/auth.router.js";
import queryRouter from "./routes/query.router.js";
import watchedRegionRouter from "./routes/watchedRegion.router.js";
import reportRouter from "./routes/report.router.js";
import dashboardRouter from "./routes/dashboard.router.js";
import remoteSensingRouter from "./routes/remoteSensing.router.js";
import translationRouter from "./routes/translation.router.js";
import { notFound, errorHandler } from "./utils/error.handler.js";
import morgan from "morgan";
import cookieParser from "cookie-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @description Main Express application — global middleware, route mounting,
 * static file serving for generated reports, and error handling.
 * @access Public
 */
const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev")); // log HTTP requests to console for debugging ;
app.use(cookieParser())

/**
 * @description Serves generated report files (CSV) so the frontend's
 * "Download" buttons can link straight to /uploads/reports/<filename>.
 * @access Public (files are named with an unguessable timestamp+userId, but
 * for real production use put this behind an authenticated download route)
 */
app.use("/uploads/reports", express.static(path.join(__dirname, "../uploads/reports")));

/**
 * @description Simple liveness check.
 * @route GET /api/health
 * @access Public
 */
app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true, message: "API is running" });
});

app.use("/api/auth", authRouter);
app.use("/api/query", queryRouter);
app.use("/api/alerts", watchedRegionRouter);
app.use("/api/reports", reportRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/remote-sensing", remoteSensingRouter);
app.use("/api/translate", translationRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
