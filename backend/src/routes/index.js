import { Router } from "express";

import authRoutes from "../modules/auth/auth.routes.js";
import usersRoutes from "../modules/users/users.routes.js";
import organizationsRoutes from "../modules/organizations/organizations.routes.js";
import cropsRoutes from "../modules/crops/crops.routes.js";
import farmsRoutes from "../modules/farms/farms.routes.js";
import plotsRoutes from "../modules/plots/plots.routes.js";
import soilRoutes from "../modules/soil/soil.routes.js";
import productionsRoutes from "../modules/productions/productions.routes.js";
import cooperativesRoutes from "../modules/cooperatives/cooperatives.routes.js";
import mediaRoutes from "../modules/media/media.routes.js";
import verificationRoutes, { adminRouter as adminVerificationRoutes } from "../modules/verification/verification.routes.js";
import reportsRoutes, { adminRouter as adminReportRoutes } from "../modules/reports/reports.routes.js";
import publicRoutes from "../modules/public/public.routes.js";
import { publicBlogRoutes, adminBlogRoutes } from "../modules/blog/blog.routes.js";
import adminRoutes from "../modules/admin/admin.routes.js";
import dashboardRoutes from "../modules/dashboard/dashboard.routes.js";
import countriesRoutes from "../modules/countries/countries.routes.js";
import notificationsRoutes from "../modules/notifications/notifications.routes.js";
import messagingRoutes from "../modules/messaging/messaging.routes.js";
import callsRoutes from "../modules/calls/calls.routes.js";
import livekitWebhookRoutes from "../modules/calls/calls.webhook.js";
import pushDevicesRoutes from "../modules/push/push.routes.js";
import { requireVerifiedForWrites } from "../middleware/auth.js";

const router = Router();

/**
 * H-07 — écritures de communication réservées aux comptes vérifiés (e-mail ou
 * téléphone). Lectures inchangées. Cette garde existait avant l'isolation V1
 * (commit e10e28c) et avait disparu lors de la découpe : elle est rétablie sur
 * les deux modules V1 concernés.
 *
 * `POST /messaging/sync` est une LECTURE (delta de messages pour le mode hors
 * ligne) malgré son verbe : elle reste ouverte comme les GET, sinon un compte
 * ajouté à un groupe ne pourrait pas lire ses messages depuis le mobile.
 */
export const estLectureEnPost = (baseUrl = "", path = "") =>
  baseUrl.endsWith("/messaging") && path.replace(/\/$/, "") === "/sync";
const gardeCommunication = (req, res, next) =>
  estLectureEnPost(req.baseUrl, req.path) ? next() : requireVerifiedForWrites(req, res, next);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      version: "1.0.0-V1",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

// Public V1
router.use("/public", publicRoutes);
router.use("/public/blog-posts", publicBlogRoutes);
router.use("/countries", countriesRoutes);

// Authentification & Identité V1
router.use("/auth", authRoutes);
router.use("/me/push-devices", pushDevicesRoutes);
router.use("/me", usersRoutes);
router.use("/notifications", notificationsRoutes);
router.use(["/messaging", "/calls"], gardeCommunication);
router.use("/messaging", messagingRoutes);
router.use("/calls", callsRoutes);
router.use("/webhooks/livekit", livekitWebhookRoutes);

// Organisations & Coopératives V1
router.use("/organizations", organizationsRoutes);
router.use("/cooperatives", cooperativesRoutes);

// Gestion agricole initiale V1
router.use("/crops", cropsRoutes);
router.use("/farms", farmsRoutes);
router.use("/plots", plotsRoutes);
router.use("/plots", soilRoutes);
router.use("/productions", productionsRoutes);
router.use("/media", mediaRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/verifications", verificationRoutes);
router.use("/reports", reportsRoutes);

// Administration V1
router.use("/admin/verifications", adminVerificationRoutes);
router.use("/admin/reports", adminReportRoutes);
router.use("/admin", adminRoutes);
router.use("/admin/blog-posts", adminBlogRoutes);

export default router;
