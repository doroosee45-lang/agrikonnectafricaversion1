import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AppErrorBoundary } from '@/components/ui/AppErrorBoundary';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/ui';
import { realtime } from '@/services/realtime';
import { selectIsAuthenticated, useAuthStore } from '@/store/auth';
import { useLocaleSync } from '@/hooks/useLocaleSync';
import { useEffect } from 'react';

// Lazy-loaded page modules
const Admin = lazy(() => import('@/pages/admin/Admin'));
const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard'));
const AdminFarmers = lazy(() => import('@/pages/admin/Farmers'));
const AdminFarms = lazy(() => import('@/pages/admin/Farms'));
const AdminPlots = lazy(() => import('@/pages/admin/Plots'));
const AdminProductions = lazy(() => import('@/pages/admin/Productions'));
const AdminUsers = lazy(() => import('@/pages/admin/Users'));
const AdminUserDetail = lazy(() => import('@/pages/admin/UserDetail'));
const AdminRoles = lazy(() => import('@/pages/admin/Roles'));
const AdminCountries = lazy(() => import('@/pages/admin/Countries'));
const AdminCountryDetail = lazy(() => import('@/pages/admin/CountryDetail'));
const AdminCrops = lazy(() => import('@/pages/admin/Crops'));
const AdminCooperatives = lazy(() => import('@/pages/admin/Cooperatives'));
const AdminVerifications = lazy(() => import('@/pages/admin/Verifications'));
const AdminReports = lazy(() => import('@/pages/admin/Reports'));
const AdminAuditLog = lazy(() => import('@/pages/admin/AuditLog'));
const AdminSettings = lazy(() => import('@/pages/admin/Settings'));
const AdminMonitoring = lazy(() => import('@/pages/admin/Monitoring'));
const AdminSecurity = lazy(() => import('@/pages/admin/Security'));
const AdminNotifications = lazy(() => import('@/pages/admin/Notifications'));
const AdminProducers = lazy(() => import('@/pages/admin/Producers'));
const AdminCompliance = lazy(() => import('@/pages/admin/Compliance'));
const AdminBlogPosts = lazy(() => import('@/pages/admin/BlogPosts'));



const AppDashboard = lazy(() => import('@/pages/app/Dashboard'));
const AppFarms = lazy(() => import('@/pages/app/Farms'));
const AppFarmDetail = lazy(() => import('@/pages/app/FarmDetail'));
const AppPlots = lazy(() => import('@/pages/app/Plots'));
const AppPlotDetail = lazy(() => import('@/pages/app/PlotDetail'));
const AppProductions = lazy(() => import('@/pages/app/Productions'));
const AppSoil = lazy(() => import('@/pages/app/Soil'));
const AppNotifications = lazy(() => import('@/pages/app/Notifications'));
const AppSmsConsent = lazy(() => import('@/pages/app/SmsConsent'));
const AppNotificationPreferences = lazy(() => import('@/pages/app/NotificationPreferences'));
const AppProfile = lazy(() => import('@/pages/app/Profile'));
const AppVerification = lazy(() => import('@/pages/app/Verification'));
const AppCooperative = lazy(() => import('@/pages/app/Cooperative'));
const AppNotFound = lazy(() => import('@/components/pages/NotFound'));

const AuthLogin = lazy(() => import('@/pages/auth/Login'));
const AuthRegister = lazy(() => import('@/pages/auth/Register'));
const AuthForgot = lazy(() => import('@/pages/auth/Forgot'));
const AuthReset = lazy(() => import('@/pages/auth/Reset'));
const AuthVerifyEmail = lazy(() => import('@/pages/auth/VerifyEmail'));
const AuthMfa = lazy(() => import('@/pages/auth/Mfa'));
const AuthVerifyPhone = lazy(() => import('@/pages/auth/VerifyPhone'));


const FarmerHome = lazy(() => import('@/pages/farmer/index'));
const FarmerProfile = lazy(() => import('@/pages/farmer/Profile'));
const FarmerPublicProfile = lazy(() => import('@/pages/farmer/PublicProfile'));
const FarmerSettings = lazy(() => import('@/pages/farmer/Settings'));
const FarmerFarms = lazy(() => import('@/pages/farmer/Farms/index'));
const FarmerFarmCreate = lazy(() => import('@/pages/farmer/Farms/Create'));
const FarmerFarmDetail = lazy(() => import('@/pages/farmer/Farms/Detail'));
const FarmerPlots = lazy(() => import('@/pages/farmer/Plots/index'));
const FarmerPlotCreate = lazy(() => import('@/pages/farmer/Plots/Create'));
const FarmerPlotDetail = lazy(() => import('@/pages/farmer/Plots/Detail'));
const FarmerPlotSoil = lazy(() => import('@/pages/farmer/Plots/Soil'));
const FarmerProductions = lazy(() => import('@/pages/farmer/Productions'));
const FarmerSoil = lazy(() => import('@/pages/farmer/Soil'));
const FarmerVerification = lazy(() => import('@/pages/farmer/Verification'));





const OrganizationHome = lazy(() => import('@/pages/organization/index'));
const OrganizationOverview = lazy(() => import('@/pages/organization/Overview'));
const OrganizationProfile = lazy(() => import('@/pages/organization/Profile'));
const OrganizationSettings = lazy(() => import('@/pages/organization/Settings'));
const OrganizationMembers = lazy(() => import('@/pages/organization/Members'));
const OrganizationInvitations = lazy(() => import('@/pages/organization/Invitations'));
const OrganizationMemberImport = lazy(() => import('@/pages/organization/MemberImport'));
const OrganizationFarms = lazy(() => import('@/pages/organization/Farms'));
const OrganizationProductionSummary = lazy(() => import('@/pages/organization/ProductionSummary'));
const OrganizationVerification = lazy(() => import('@/pages/organization/Verification'));

const PublicHome = lazy(() => import('@/pages/public/Home'));
const PublicBlogPost = lazy(() => import('@/pages/public/BlogPost'));
const PublicBlog = lazy(() => import('@/pages/public/Blog'));
const PublicServices = lazy(() => import('@/pages/public/Services'));
const PublicAbout = lazy(() => import('@/pages/public/About'));
const PublicServiceDetail = lazy(() => import('@/pages/public/ServiceDetail'));
const PublicFarmers = lazy(() => import('@/pages/public/Farmers'));
const PublicFarmProfile = lazy(() => import('@/pages/public/FarmProfile'));
const PublicCooperatives = lazy(() => import('@/pages/public/Cooperatives'));
const PublicCooperativeProfile = lazy(() => import('@/pages/public/CooperativeProfile'));
const PublicAgricultureCountry = lazy(() => import('@/pages/public/AgricultureCountry'));
const PublicCountryLanguageSelector = lazy(() => import('@/pages/public/CountryLanguageSelector'));
const PublicLegal = lazy(() => import('@/pages/public/Legal'));



function App() {
  const init = useAuthStore((state) => state.init);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  // I18N — langue d'interface reportée sur le profil (notifications, e-mails).
  useLocaleSync();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!isAuthenticated) {
      realtime.disconnect();
      return;
    }

    realtime.connect();
    return () => realtime.disconnect();
  }, [isAuthenticated]);

  return (
    <BrowserRouter>
      <AppLayout>
        <AppErrorBoundary>
          <Suspense fallback={<div style={{ padding: 48 }}><LoadingState count={2} height={120} /></div>}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<PublicHome />} />
            <Route path="/services" element={<PublicServices />} />
            <Route path="/a-propos" element={<PublicAbout />} />
            <Route path="/services/:serviceId" element={<PublicServiceDetail />} />
            <Route path="/public/farmers" element={<PublicFarmers />} />
            <Route path="/public/farms/:slug" element={<PublicFarmProfile />} />            <Route path="/public/cooperatives" element={<PublicCooperatives />} />
            <Route path="/public/cooperatives/:slug" element={<PublicCooperativeProfile />} />            <Route path="/public/agriculture/:countryCode" element={<PublicAgricultureCountry />} />
            <Route path="/public/country-language" element={<PublicCountryLanguageSelector />} />
            <Route path="/public/legal" element={<PublicLegal />} />
            <Route path="/public/blog" element={<PublicBlog />} />
            <Route path="/public/blog/:slug" element={<PublicBlogPost />} />

            {/* Auth routes */}
            <Route path="/auth/login" element={<AuthLogin />} />
            <Route path="/auth/register" element={<AuthRegister />} />
            <Route path="/auth/forgot" element={<AuthForgot />} />
            <Route path="/auth/reset" element={<AuthReset />} />
            <Route path="/auth/verify-email" element={<AuthVerifyEmail />} />
            <Route path="/auth/mfa" element={<AuthMfa />} />
            <Route path="/auth/verify-phone" element={<AuthVerifyPhone />} />

            {/* Admin routes */}
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/farmers" element={<AdminFarmers />} />
            <Route path="/admin/farms" element={<AdminFarms />} />
            <Route path="/admin/plots" element={<AdminPlots />} />
            <Route path="/admin/productions" element={<AdminProductions />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/users/:id" element={<AdminUserDetail />} />
            <Route path="/admin/roles" element={<AdminRoles />} />            <Route path="/admin/countries" element={<AdminCountries />} />
            <Route path="/admin/countries/:code" element={<AdminCountryDetail />} />
            <Route path="/admin/crops" element={<AdminCrops />} />
            <Route path="/admin/cooperatives" element={<AdminCooperatives />} />            <Route path="/admin/verifications" element={<AdminVerifications />} />
            <Route path="/admin/reports" element={<AdminReports />} />
            <Route path="/admin/audit" element={<AdminAuditLog />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
            <Route path="/admin/monitoring" element={<AdminMonitoring />} />            <Route path="/admin/security" element={<AdminSecurity />} />            <Route path="/admin/notifications" element={<AdminNotifications />} />            <Route path="/admin/producers" element={<AdminProducers />} />            <Route path="/admin/compliance" element={<AdminCompliance />} />            <Route path="/admin/blog-posts" element={<AdminBlogPosts />} />

            {/* Agent routes */}
            {/* AI routes */}
            {/* App routes (authenticated) */}
            <Route path="/app" element={<AppDashboard />} />
            <Route path="/app/farms" element={<AppFarms />} />
            <Route path="/app/farms/:id" element={<AppFarmDetail />} />
            <Route path="/app/plots" element={<AppPlots />} />
            <Route path="/app/plots/:id" element={<AppPlotDetail />} />
            <Route path="/app/productions" element={<AppProductions />} />
            <Route path="/app/soil" element={<AppSoil />} />            <Route path="/app/notifications" element={<AppNotifications />} />
            <Route path="/app/sms-consent" element={<AppSmsConsent />} />
            <Route path="/notifications/preferences" element={<AppNotificationPreferences />} />
            <Route path="/notifications/sms-consent" element={<Navigate to="/app/sms-consent" replace />} />            <Route path="/app/profile" element={<AppProfile />} />
            <Route path="/app/verification" element={<AppVerification />} />            <Route path="/app/cooperative" element={<AppCooperative />} />
            {/* Developer routes */}
            {/* Farmer routes */}
            <Route path="/farmer" element={<FarmerHome />} />
            <Route path="/farmer/profile" element={<FarmerProfile />} />
            <Route path="/farmer/public-profile" element={<FarmerPublicProfile />} />
            <Route path="/farmer/settings" element={<FarmerSettings />} />            <Route path="/farmer/farms" element={<FarmerFarms />} />
            <Route path="/farmer/farms/create" element={<FarmerFarmCreate />} />
            <Route path="/farmer/farms/:id" element={<FarmerFarmDetail />} />
            <Route path="/farmer/plots" element={<FarmerPlots />} />
            <Route path="/farmer/plots/create" element={<FarmerPlotCreate />} />
            <Route path="/farmer/plots/:id" element={<FarmerPlotDetail />} />
            <Route path="/farmer/plots/:id/soil" element={<FarmerPlotSoil />} />            <Route path="/farmer/productions" element={<FarmerProductions />} />
            <Route path="/farmer/soil" element={<FarmerSoil />} />            <Route path="/farmer/verification" element={<FarmerVerification />} />
            {/* Insights routes */}
            {/* International routes */}
            {/* Market routes */}
            {/* Organization routes */}
            <Route path="/organization" element={<OrganizationHome />} />
            <Route path="/organization/overview" element={<OrganizationOverview />} />
            <Route path="/organization/profile" element={<OrganizationProfile />} />
            <Route path="/organization/:id/profile" element={<OrganizationProfile />} />
            <Route path="/organization/settings" element={<OrganizationSettings />} />
            <Route path="/organization/:id/settings" element={<OrganizationSettings />} />
            <Route path="/organization/members" element={<OrganizationMembers />} />
            <Route path="/organization/invitations" element={<OrganizationInvitations />} />
            <Route path="/organization/import" element={<OrganizationMemberImport />} />
            <Route path="/organization/farms" element={<OrganizationFarms />} />
            <Route path="/organization/production" element={<OrganizationProductionSummary />} />
            <Route path="/organization/verification" element={<OrganizationVerification />} />

            {/* Reviewer routes */}
            {/* Standalone data routes */}
            {/* Catch-all */}
            <Route path="*" element={<AppNotFound />} />
          </Routes>
          </Suspense>
        </AppErrorBoundary>
      </AppLayout>
    </BrowserRouter>
  );
}

export default App;
