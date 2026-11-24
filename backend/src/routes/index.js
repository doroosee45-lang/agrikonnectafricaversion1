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

const router = Router();

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
router.use("/me", usersRoutes);
router.use("/notifications", notificationsRoutes);

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
