import React, { useState, useEffect } from "react";
import {
  Home,
  BarChart2,
  Upload,
  Video,
  LogOut,
  Camera,
  Activity,
  CheckCircle,
  Plus,
  ShoppingBag,
  ArrowLeft,
  RefreshCw,
  Server,
  LifeBuoy,
  Trash2,
  Search,
  Filter,
  Star,
  MessageSquare,
  Users,
  Clock,
  TrendingUp,
  Maximize2,
  ShieldAlert,
  Send,
  AlertCircle,
  Eye,
  EyeOff,
  Box,
  Menu,
  X
} from "lucide-react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell } from "recharts";
import {
  getGarments, uploadGarment, deleteGarment, checkBackendHealth, Garment, PRODUCT_CATEGORIES, MEN_CATEGORIES, WOMEN_CATEGORIES, detectGarmentCategory, detectGarmentGender,
  getSupportTickets, createSupportTicket, updateSupportTicketStatus, deleteSupportTicket, getSystemDiagnostics, SupportTicket, SystemDiagnostics,
  getFeedbackAnalytics, FeedbackAnalyticsResponse, adminLogin
} from "../services/api";

import imgAvatarUser from "../../imports/AdminSecurity-1/6c1fe88a3b9e8dfddf4a065581b04df49638ca9c.png";
import imgSecurityFeed from "../../imports/AdminSecurity-1/7f12ea1300756f144a0fb5daaf68dbfc01103a46.png";
import imgSaree1 from "../../assets/saree_model_1.png";
import imgSaree2 from "../../assets/saree_model_2.png";
import imgSaree3 from "../../assets/saree_model_3.png";
import imgSaree4 from "../../assets/saree_model_4.png";
import { supabase } from "../utils/supabaseClient";
import { SecurityDetector } from "../utils/motion-detection";

type TabType = "home" | "analytics" | "upload" | "security" | "support";

const analyticsData = [
  { name: "Mon", tryOns: 145, visitors: 420 },
  { name: "Tue", tryOns: 182, visitors: 540 },
  { name: "Wed", tryOns: 278, visitors: 800 },
  { name: "Thu", tryOns: 235, visitors: 710 },
  { name: "Fri", tryOns: 395, visitors: 1150 },
  { name: "Sat", tryOns: 640, visitors: 1880 },
  { name: "Sun", tryOns: 510, visitors: 1510 },
];

const categoryDistribution = [
  { name: "Sarees", value: 35, color: "#ec4899" },
  { name: "Shirts", value: 25, color: "#3b82f6" },
  { name: "Dresses", value: 20, color: "#8b5cf6" },
  { name: "Jeans", value: 12, color: "#10b981" },
  { name: "Jackets", value: 8, color: "#f59e0b" },
];

const mostTriedProducts = [
  { name: "Emerald Silk Kanjivaram Saree", category: "Sarees", tryOns: 1240, rating: 4.9 },
  { name: "Classic White Oxford Cotton Shirt", category: "Shirts", tryOns: 980, rating: 4.8 },
  { name: "Indigo Blue Slim Fit Denim Jeans", category: "Jeans", tryOns: 820, rating: 4.7 },
  { name: "Velvet Bridal Designer Lehenga", category: "Dresses", tryOns: 750, rating: 4.9 },
  { name: "Printed Festive Anarkali Kurta", category: "Kurtas", tryOns: 620, rating: 4.6 },
];

const customerFeedbackLog = [
  { id: 1, user: "Priya Sharma", rating: 5, comment: "Virtual mirror color matching for Sarees is extremely accurate! Loved the trial.", date: "Today, 11:30 AM" },
  { id: 2, user: "Rahul Verma", rating: 5, comment: "Changing shirt sizes on screen was instant. Saved so much fitting room waiting time.", date: "Today, 10:15 AM" },
  { id: 3, user: "Ananya Roy", rating: 4, comment: "QR code instant download to phone worked seamlessly.", date: "Yesterday" },
];

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>("analytics");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => sessionStorage.getItem("admin_auth") === "true");
  const [loggedInUser, setLoggedInUser] = useState<string>(() => sessionStorage.getItem("admin_user") || "Admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Change Password Modal State
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [cpStep, setCpStep] = useState<"credentials" | "otp" | "done">("credentials");
  const [cpUsername, setCpUsername] = useState("");
  const [cpCurrentPwd, setCpCurrentPwd] = useState("");
  const [cpOtp, setCpOtp] = useState("");
  const [cpNewPwd, setCpNewPwd] = useState("");
  const [cpConfirmPwd, setCpConfirmPwd] = useState("");
  const [cpError, setCpError] = useState("");
  const [cpSuccess, setCpSuccess] = useState("");
  const [cpLoading, setCpLoading] = useState(false);
  const [cpDevOtp, setCpDevOtp] = useState("");

  const API_BASE = (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:5000";

  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setSuccessMessage("");
    const res = await adminLogin({ username, password });
    if (res.success) {
      sessionStorage.setItem("admin_auth", "true");
      sessionStorage.setItem("admin_user", username);
      setLoggedInUser(username);
      setIsAuthenticated(true);
      setLoginError("");
    } else {
      setLoginError(res.error || "Invalid credentials. Try again.");
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("admin_auth");
    sessionStorage.removeItem("admin_user");
    setIsAuthenticated(false);
    setLoggedInUser("Admin");
    setUsername("");
    setPassword("");
  };

  const openChangePassword = () => {
    setShowChangePassword(true);
    setCpStep("credentials");
    setCpUsername(username || "");
    setCpCurrentPwd("");
    setCpOtp("");
    setCpNewPwd("");
    setCpConfirmPwd("");
    setCpError("");
    setCpSuccess("");
    setCpDevOtp("");
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpError("");
    setCpLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/request-password-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cpUsername, current_password: cpCurrentPwd }),
      });
      const data = await res.json();
      if (data.success) {
        setCpSuccess(data.message);
        if (data.dev_otp) setCpDevOtp(data.dev_otp);
        setCpStep("otp");
      } else {
        setCpError(data.error || "Failed to send OTP.");
      }
    } catch {
      setCpError("Network error. Is the backend running?");
    } finally {
      setCpLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpError("");
    if (cpNewPwd !== cpConfirmPwd) {
      setCpError("New passwords do not match.");
      return;
    }
    if (cpNewPwd.length < 6) {
      setCpError("Password must be at least 6 characters.");
      return;
    }
    setCpLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/verify-change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cpUsername, otp: cpOtp, new_password: cpNewPwd }),
      });
      const data = await res.json();
      if (data.success) {
        setCpSuccess(data.message);
        setCpStep("done");
      } else {
        setCpError(data.error || "Failed to verify OTP.");
      }
    } catch {
      setCpError("Network error. Is the backend running?");
    } finally {
      setCpLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-[#1a0c0e] to-neutral-950 flex items-center justify-center p-4 font-sans w-full">
        {/* Main split card container */}
        <div className="w-full max-w-[1000px] bg-[#111111]/90 backdrop-blur-md border border-neutral-800/80 rounded-[28px] shadow-2xl flex overflow-hidden min-h-[580px]">

          {/* Left panel: Vertical saree strips (Hidden on mobile) */}
          <div className="hidden md:flex w-1/2 relative overflow-hidden select-none">
            <div className="w-1/4 h-full relative overflow-hidden border-r border-neutral-900/40">
              <img src={imgSaree1} className="w-full h-full object-cover brightness-[0.8] hover:brightness-100 hover:scale-105 transition-all duration-700 ease-out" alt="Ethnic collection slice 1" />
            </div>
            <div className="w-1/4 h-full relative overflow-hidden border-r border-neutral-900/40">
              <img src={imgSaree2} className="w-full h-full object-cover brightness-[0.8] hover:brightness-100 hover:scale-105 transition-all duration-700 ease-out" alt="Ethnic collection slice 2" />
            </div>
            <div className="w-1/4 h-full relative overflow-hidden border-r border-neutral-900/40">
              <img src={imgSaree3} className="w-full h-full object-cover brightness-[0.8] hover:brightness-100 hover:scale-105 transition-all duration-700 ease-out" alt="Ethnic collection slice 3" />
            </div>
            <div className="w-1/4 h-full relative overflow-hidden">
              <img src={imgSaree4} className="w-full h-full object-cover brightness-[0.8] hover:brightness-100 hover:scale-105 transition-all duration-700 ease-out" alt="Ethnic collection slice 4" />
            </div>
          </div>

          {/* Right panel: Login Form */}
          <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center gap-6 text-white bg-[#0e0e0e]/95">
            <div className="text-center flex flex-col gap-3">
              <div className="text-[11px] font-semibold tracking-[0.3em] text-neutral-400 uppercase select-none font-serif">
                L A V I X
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white mt-1">Admin Portal</h1>
              <p className="text-xs text-neutral-400">Enter your credentials to access the Lavix console</p>
            </div>

            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-300 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            {successMessage && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmitAuth} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  placeholder="Username / Email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3.5 bg-neutral-900 border border-neutral-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600/80 text-sm font-medium transition-all text-white placeholder-neutral-500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5 relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 pr-12 py-3.5 bg-neutral-900 border border-neutral-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600/80 text-sm font-medium transition-all text-white placeholder-neutral-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white transition-colors bg-transparent border-0 cursor-pointer outline-none p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                type="submit"
                className="w-full bg-[#e31e24] hover:bg-[#c9181d] text-white font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-red-600/10 active:scale-[0.98] mt-2 cursor-pointer"
              >
                Sign In
              </button>

              <div className="flex items-center justify-between mt-1 text-xs text-neutral-400">
                <label className="flex items-center gap-2 cursor-pointer font-normal text-xs text-neutral-400">
                  <input type="checkbox" className="rounded border-neutral-800 bg-neutral-900 text-red-600 focus:ring-red-600/50" />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={() => { setUsername("yaswanthbyrapuneni@gmail.com"); setPassword("adminpassword"); }}
                  className="text-neutral-500 hover:text-neutral-300 transition-colors bg-transparent border-0 cursor-pointer outline-none"
                >
                  Use Default Credentials
                </button>
              </div>
            </form>

            {/* Change Password link */}
            <div className="text-center pt-2 border-t border-neutral-900">
              <button
                onClick={openChangePassword}
                className="text-red-500 hover:text-red-400 text-xs font-semibold transition-colors bg-transparent border-0 cursor-pointer outline-none"
              >
                🔑 Change Password
              </button>
            </div>
          </div>
        </div>

        {/* Change Password Modal */}
        {showChangePassword && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-[440px] bg-[#111] border border-neutral-800 rounded-2xl shadow-2xl p-8 flex flex-col gap-5 text-white relative">
              <button
                onClick={() => setShowChangePassword(false)}
                className="absolute top-4 right-4 text-neutral-500 hover:text-white bg-transparent border-0 cursor-pointer text-lg leading-none"
              >✕</button>

              <div className="text-center">
                <div className="text-[10px] tracking-[0.3em] text-neutral-500 uppercase font-serif mb-1">L A V I X</div>
                <h2 className="text-2xl font-bold">Change Password</h2>
                <p className="text-xs text-neutral-400 mt-1">
                  {cpStep === "credentials" && "Verify your current credentials to receive an OTP"}
                  {cpStep === "otp" && "Enter the OTP sent to your admin email"}
                  {cpStep === "done" && "Password changed successfully!"}
                </p>
              </div>

              {cpError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-300 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{cpError}</span>
                </div>
              )}

              {cpSuccess && cpStep !== "done" && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{cpSuccess}</span>
                  {cpDevOtp && <span className="ml-2 font-mono text-amber-400">[DEV OTP: {cpDevOtp}]</span>}
                </div>
              )}

              {cpStep === "credentials" && (
                <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
                  <input
                    type="text"
                    placeholder="Username (e.g. admin)"
                    value={cpUsername}
                    onChange={(e) => setCpUsername(e.target.value)}
                    className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600/80 text-sm text-white placeholder-neutral-500"
                    required
                  />
                  <input
                    type="password"
                    placeholder="Current Password"
                    value={cpCurrentPwd}
                    onChange={(e) => setCpCurrentPwd(e.target.value)}
                    className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600/80 text-sm text-white placeholder-neutral-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={cpLoading}
                    className="w-full bg-[#e31e24] hover:bg-[#c9181d] disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-all cursor-pointer"
                  >
                    {cpLoading ? "Sending OTP…" : "Send Verification OTP"}
                  </button>
                </form>
              )}

              {cpStep === "otp" && (
                <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
                  <input
                    type="text"
                    placeholder="Enter 6-digit OTP"
                    value={cpOtp}
                    onChange={(e) => setCpOtp(e.target.value)}
                    maxLength={6}
                    className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600/80 text-sm text-white placeholder-neutral-500 tracking-widest text-center font-mono text-lg"
                    required
                  />
                  <input
                    type="password"
                    placeholder="New Password (min. 6 chars)"
                    value={cpNewPwd}
                    onChange={(e) => setCpNewPwd(e.target.value)}
                    className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600/80 text-sm text-white placeholder-neutral-500"
                    required
                  />
                  <input
                    type="password"
                    placeholder="Confirm New Password"
                    value={cpConfirmPwd}
                    onChange={(e) => setCpConfirmPwd(e.target.value)}
                    className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600/80 text-sm text-white placeholder-neutral-500"
                    required
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setCpStep("credentials"); setCpError(""); }}
                      className="flex-1 border border-neutral-700 text-neutral-300 hover:text-white py-3 rounded-xl text-sm transition-all cursor-pointer bg-transparent"
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={cpLoading}
                      className="flex-1 bg-[#e31e24] hover:bg-[#c9181d] disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-all cursor-pointer"
                    >
                      {cpLoading ? "Verifying…" : "Set New Password"}
                    </button>
                  </div>
                </form>
              )}

              {cpStep === "done" && (
                <div className="flex flex-col items-center gap-4">
                  <CheckCircle className="w-16 h-16 text-emerald-400" />
                  <p className="text-emerald-300 font-semibold text-center">{cpSuccess}</p>
                  <button
                    onClick={() => setShowChangePassword(false)}
                    className="w-full bg-[#e31e24] hover:bg-[#c9181d] text-white font-bold py-3 rounded-xl text-sm transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#f3f5f9] flex items-start relative size-full min-h-screen font-sans overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} loggedInUser={loggedInUser} />
      <div className="flex-1 w-full h-screen overflow-y-auto overflow-x-hidden p-[16px] pt-[72px] md:p-[24px]">
        {activeTab === "home" && <HomeView setActiveTab={setActiveTab} />}
        {activeTab === "analytics" && <AnalyticsView />}
        {activeTab === "upload" && <UploadGarmentsView />}
        {activeTab === "security" && <SecurityView />}
        {activeTab === "support" && <TechnicalSupportView />}
      </div>
    </div>
  );
}

function Sidebar({ activeTab, setActiveTab, onLogout, loggedInUser }: { activeTab: TabType; setActiveTab: (tab: TabType) => void; onLogout: () => void; loggedInUser: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Same tab switch on mobile also closes the drawer, so the panel doesn't
  // sit open over the newly-selected view.
  const handleNav = (tab: TabType) => {
    setActiveTab(tab);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile-only toggle — the sidebar itself is off-canvas by default
          below md:, so there has to be something on screen to open it. */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-40 p-2.5 bg-white rounded-xl border border-[#e8e8e8] shadow-md text-gray-700"
        title="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Backdrop, mobile only, only while the drawer is open */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 bg-black/40 z-30"
        />
      )}

      <div
        className={`bg-white h-screen fixed md:sticky top-0 left-0 flex flex-col justify-between shrink-0 w-[250px] border-r border-[#e8e8e8] shadow-sm z-40 transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="flex flex-col gap-[24px] pt-[28px] w-full">
          {/* Logo & Store Link */}
          <div className="pl-[24px] pr-[12px] w-full flex items-center justify-between gap-1">
            <div className="flex flex-col gap-1">
              <p className="font-bold text-[18px] text-gray-900 tracking-tight flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-indigo-600" />
                Lavix Hub
              </p>
              <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full w-fit">
                Retailer Portal
              </span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="md:hidden p-1.5 text-gray-400 hover:bg-gray-100 rounded-md"
              title="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <div className="flex flex-col gap-[4px] px-[16px] w-full">
            <NavItem icon={<Home className="w-5 h-5" />} label="Dashboard Overview" active={activeTab === "home"} onClick={() => handleNav("home")} />
            <NavItem icon={<BarChart2 className="w-5 h-5" />} label="Retail Analytics" active={activeTab === "analytics"} onClick={() => handleNav("analytics")} />
            <NavItem icon={<Upload className="w-5 h-5" />} label="Catalogue Manager" active={activeTab === "upload"} onClick={() => handleNav("upload")} />
            <NavItem icon={<Video className="w-5 h-5" />} label="CCTV Surveillance" active={activeTab === "security"} onClick={() => handleNav("security")} />
            <NavItem icon={<LifeBuoy className="w-5 h-5" />} label="Tech Support" active={activeTab === "support"} onClick={() => handleNav("support")} />
          </div>
        </div>

        <div className="flex flex-col gap-[16px] pb-[28px] px-[16px] w-full">
          <Link to="/home" className="flex items-center gap-[12px] px-[12px] py-[10px] rounded-[10px] w-full text-indigo-600 bg-indigo-50/70 hover:bg-indigo-100 font-semibold text-[14px] transition-colors border border-indigo-100">
            <ArrowLeft className="w-4 h-4" />
            <span>Customer Storefront</span>
          </Link>

          {/* User Account */}
          <div className="flex items-center justify-between pl-[4px] pt-[16px] border-t border-[#eaecf0] w-full">
            <p className="font-semibold text-[#344054] text-[14px] truncate flex-1">
              {loggedInUser.charAt(0).toUpperCase() + loggedInUser.slice(1)}
            </p>
            <button onClick={onLogout} className="p-2 text-[#475467] hover:bg-gray-100 rounded-md transition-colors shrink-0 cursor-pointer" title="Logout">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-[12px] px-[12px] py-[10px] rounded-[10px] w-full transition-all relative ${active ? 'bg-indigo-600 text-white font-semibold shadow-md' : 'hover:bg-gray-100 text-gray-700'}`}>
      <div className="shrink-0">{icon}</div>
      <span className="font-medium text-[14px] flex-1 text-left">{label}</span>
    </button>
  );
}

/* --- VIEWS --- */

function HomeView({ setActiveTab }: { setActiveTab: (tab: TabType) => void }) {
  const [garmentsCount, setGarmentsCount] = useState<number>(0);
  const [isBackendAlive, setIsBackendAlive] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<any>({
    footfall: 0,
    total_sessions: 0,
    completion_rate: 0
  });

  useEffect(() => {
    checkBackendHealth().then((res) => setIsBackendAlive(!!res));
    getGarments().then((list) => setGarmentsCount(list.length));
    getFeedbackAnalytics().then((res) => {
      if (res && res.summary) {
        setSummary(res.summary);
      }
    });
  }, []);

  return (
    <div className="max-w-[1100px] mx-auto mt-[8px] flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <h1 className="font-bold text-gray-900 text-[26px]">Lavix Command Center</h1>
          <p className="text-gray-500 text-[14px] mt-1">Real-time control over store analytics, product catalog, CCTV feeds, and Virtual Mirror sessions.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={() => setActiveTab("analytics")} className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium text-sm hover:bg-indigo-700 transition-all shadow-md">
            <BarChart2 className="w-4 h-4" /> Retail Analytics
          </button>
          <button onClick={() => setActiveTab("upload")} className="flex items-center justify-center gap-2 bg-gray-900 text-white px-4 py-2.5 rounded-xl font-medium text-sm hover:bg-black transition-all shadow-md">
            <Plus className="w-4 h-4" /> Add Garment
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Visitors</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-gray-900">{summary.footfall ? summary.footfall.toLocaleString() : "0"}</span>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">+24%</span>
          </div>
          <span className="text-xs text-gray-500 mt-2">Daily Avg: {summary.footfall ? Math.round(summary.footfall / 10).toLocaleString() : "0"} footfall</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Try-On Sessions</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-gray-900">{summary.total_sessions ? summary.total_sessions.toLocaleString() : "0"}</span>
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">+31%</span>
          </div>
          <span className="text-xs text-gray-500 mt-2">Completion Rate: {summary.completion_rate || 0}%</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Catalog</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-gray-900">{garmentsCount}</span>
            <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">Live</span>
          </div>
          <span className="text-xs text-gray-500 mt-2">Auto-Categorized</span>
        </div>
      </div>
    </div>
  );
}

function AnalyticsView() {
  const [timeRange, setTimeRange] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [feedbackAnalytics, setFeedbackAnalytics] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchFeedback = () => {
    getFeedbackAnalytics().then((res) => {
      if (res) {
        setFeedbackAnalytics(res);
      }
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchFeedback();
  }, []);

  const summary = feedbackAnalytics?.summary || {
    avg_rating: 4.8,
    total_feedback: 1240,
    total_skipped: 320,
    completion_rate: 79.5,
    emoji_counts: { "😍": 750, "😄": 310, "🙂": 120, "😐": 40, "😞": 20 }
  };

  const fallbackDaily = [
    { name: "09:00", tryOns: 5, visitors: 15, submitted: 4, skipped: 1 },
    { name: "11:00", tryOns: 12, visitors: 35, submitted: 9, skipped: 3 },
    { name: "13:00", tryOns: 25, visitors: 60, submitted: 18, skipped: 7 },
    { name: "15:00", tryOns: 40, visitors: 110, submitted: 30, skipped: 10 },
    { name: "17:00", tryOns: 65, visitors: 180, submitted: 50, skipped: 15 },
    { name: "19:00", tryOns: 50, visitors: 140, submitted: 38, skipped: 12 },
    { name: "21:00", tryOns: 20, visitors: 55, submitted: 15, skipped: 5 }
  ];

  const fallbackWeekly = [
    { name: "Mon", tryOns: 145, visitors: 420, submitted: 110, skipped: 35 },
    { name: "Tue", tryOns: 182, visitors: 540, submitted: 140, skipped: 42 },
    { name: "Wed", tryOns: 278, visitors: 800, submitted: 210, skipped: 68 },
    { name: "Thu", tryOns: 235, visitors: 710, submitted: 180, skipped: 55 },
    { name: "Fri", tryOns: 395, visitors: 1150, submitted: 300, skipped: 95 },
    { name: "Sat", tryOns: 640, visitors: 1880, submitted: 500, skipped: 140 },
    { name: "Sun", tryOns: 510, visitors: 1510, submitted: 390, skipped: 120 }
  ];

  const fallbackMonthly = [
    { name: "Jan", tryOns: 1200, visitors: 3500, submitted: 920, skipped: 280 },
    { name: "Feb", tryOns: 1500, visitors: 4200, submitted: 1150, skipped: 350 },
    { name: "Mar", tryOns: 1800, visitors: 5000, submitted: 1400, skipped: 400 },
    { name: "Apr", tryOns: 2400, visitors: 6800, submitted: 1850, skipped: 550 },
    { name: "May", tryOns: 3100, visitors: 9000, submitted: 2400, skipped: 700 },
    { name: "Jun", tryOns: 4500, visitors: 12500, submitted: 3500, skipped: 1000 }
  ];
  const trendData = (feedbackAnalytics?.trends?.[timeRange] && feedbackAnalytics.trends[timeRange].length > 0)
    ? feedbackAnalytics.trends[timeRange]
    : [];

  // Footfall/rate/rating cards below scope to whichever tab is selected, so
  // they always describe the same window as the chart under them, not the
  // all-time totals in `summary`. Falls back to `summary` itself only if the
  // backend response predates period_summary existing.
  const periodSummary = feedbackAnalytics?.period_summary?.[timeRange] || summary;

  const recentFeedback = feedbackAnalytics?.recent || [];

  const emojiLabels: Record<string, string> = {
    "😍": "Excellent (5/5)",
    "😄": "Good (3/5)",
    "😞": "Bad (1/5)"
  };

  const emojiColors: Record<string, string> = {
    "😍": "#ec4899",
    "😄": "#3b82f6",
    "😞": "#f04438"
  };

  return (
    <div className="max-w-[1100px] mx-auto mt-[8px] flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <h1 className="font-bold text-gray-900 text-[26px]">Retail Analytics & Customer Insights</h1>
          <p className="text-gray-500 text-[14px]">Footfall metrics, try-on conversions, feedback rating, and garment demand forecasting.</p>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl text-xs font-semibold">
          <button onClick={() => setTimeRange("daily")} className={`px-4 py-2 rounded-lg transition-all ${timeRange === "daily" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>Daily</button>
          <button onClick={() => setTimeRange("weekly")} className={`px-4 py-2 rounded-lg transition-all ${timeRange === "weekly" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>Weekly</button>
          <button onClick={() => setTimeRange("monthly")} className={`px-4 py-2 rounded-lg transition-all ${timeRange === "monthly" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>Monthly</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-1">
          <span className="text-xs text-gray-400 font-semibold uppercase">Total Footfall</span>
          <span className="text-2xl font-bold text-gray-900">{periodSummary.footfall !== undefined ? periodSummary.footfall.toLocaleString() : "0"} Visitors</span>
          <span className="text-xs text-emerald-600 font-semibold">{periodSummary.total_sessions > 0 ? "+18.4% growth" : "0% growth"}</span>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-1">
          <span className="text-xs text-gray-400 font-semibold uppercase">Try-On Session Rate</span>
          <span className="text-2xl font-bold text-gray-900">{periodSummary.try_on_rate !== undefined ? periodSummary.try_on_rate : "0"}%</span>
          <span className="text-xs text-indigo-600 font-semibold">{periodSummary.total_sessions !== undefined ? periodSummary.total_sessions.toLocaleString() : "0"} total sessions</span>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-1">
          <span className="text-xs text-gray-400 font-semibold uppercase">Avg Session Length</span>
          <span className="text-2xl font-bold text-gray-900">{summary.avg_session_length || "0s"}</span>
          <span className="text-xs text-purple-600 font-semibold">{summary.session_engagement || "No sessions yet"}</span>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-1">
          <span className="text-xs text-gray-400 font-semibold uppercase">Customer Rating (CSAT)</span>
          <span className="text-2xl font-bold text-amber-500 flex items-center gap-1">⭐ {periodSummary.avg_rating !== undefined ? periodSummary.avg_rating : "0.0"} / 5.0</span>
          <span className="text-xs text-gray-500 font-medium">{periodSummary.completion_rate !== undefined ? periodSummary.completion_rate : "0"}% Completion Rate</span>
        </div>
      </div>

      {/* AI Render Reliability — how try-on requests are actually resolving:
          a real fitted Vertex render, the flat local-compositor fallback, or
          a hard failure. Surfaces problems as a trend instead of only via a
          shop owner's screenshot. */}
      {(() => {
        const reliability = feedbackAnalytics?.tryon_reliability || { vertex: 0, local: 0, failed: 0, total: 0, vertex_success_rate: 0 };
        if (reliability.total === 0) return null;
        return (
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-base">AI Render Reliability</h3>
              <span className="text-xs text-gray-400 font-medium">Last {reliability.total} try-ons</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-bold text-emerald-600">{reliability.vertex_success_rate}%</span>
                <span className="text-xs text-gray-500 font-medium">Real AI-fitted renders</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xl font-bold text-gray-900">{reliability.vertex}</span>
                <span className="text-xs text-gray-500 font-medium">Vertex AI</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xl font-bold text-amber-600">{reliability.local}</span>
                <span className="text-xs text-gray-500 font-medium">Fallback preview</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xl font-bold text-red-600">{reliability.failed}</span>
                <span className="text-xs text-gray-500 font-medium">Failed</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-base">Visitor Footfall vs Virtual Try-On Sessions</h3>
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">Live Analytics</span>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorVisitors" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorTryOns" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="visitors" stroke="#6366f1" fillOpacity={1} fill="url(#colorVisitors)" name="Visitors" />
                <Area type="monotone" dataKey="tryOns" stroke="#10b981" fillOpacity={1} fill="url(#colorTryOns)" name="Try-On Sessions" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Share */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
          <h3 className="font-bold text-gray-900 text-base">Most Viewed Categories</h3>
          <div className="flex flex-col gap-3">
            {(feedbackAnalytics?.category_distribution || categoryDistribution).map((cat: any) => (
              <div key={cat.name} className="flex flex-col gap-1">
                <div className="flex justify-between text-xs font-semibold text-gray-700">
                  <span>{cat.name}</span>
                  <span>{cat.value}%</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${cat.value}%`, backgroundColor: cat.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Customer Feedback Analytics Section */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-6">
        <div className="border-b border-gray-100 pb-4 flex justify-between items-center">
          <div>
            <h2 className="font-bold text-gray-900 text-lg flex items-center gap-2">
              ✨ Customer Feedback Analytics
            </h2>
            <p className="text-gray-500 text-xs mt-1">Real-time ratings, completion metrics, and emoji analysis from the Virtual Try-On flow.</p>
          </div>
          <button onClick={fetchFeedback} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all border-0 bg-transparent cursor-pointer" title="Refresh Feedback">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* KPI Sub-Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">⭐ Average Rating</span>
            <span className="text-xl font-black text-gray-950">{summary.avg_rating} / 5.0</span>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">📝 Total Feedback</span>
            <span className="text-xl font-black text-gray-950">{summary.total_feedback}</span>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">⏭ Total Skipped</span>
            <span className="text-xl font-black text-gray-950">{summary.total_skipped}</span>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">📊 Feedback Completion %</span>
            <span className="text-xl font-black text-gray-950">{summary.completion_rate}%</span>
          </div>
        </div>

        {/* Emoji Breakdown & Trends */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-gray-50/50 p-5 rounded-xl border border-gray-200 flex flex-col gap-4">
            <h4 className="font-bold text-gray-900 text-sm">Emoji distribution</h4>
            <div className="flex flex-col gap-3.5">
              {Object.entries(summary.emoji_counts).map(([emoji, count]) => {
                const total = summary.total_feedback || 1;
                const percentage = Math.round(((count as number) / total) * 100);
                return (
                  <div key={emoji} className="flex items-center gap-3">
                    <span className="text-2xl shrink-0">{emoji}</span>
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="flex justify-between text-xs font-semibold text-gray-700">
                        <span>{emojiLabels[emoji] || emoji}</span>
                        <span>{count as number} ({percentage}%)</span>
                      </div>
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: emojiColors[emoji] || "#6366f1"
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 bg-gray-50/50 p-5 rounded-xl border border-gray-200 flex flex-col gap-4">
            <h4 className="font-bold text-gray-900 text-sm uppercase tracking-wide">
              {timeRange.toUpperCase()} FEEDBACK TRENDS
            </h4>
            <div className="h-[230px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="colorSubmitted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSkipped" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#9ca3af" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#9ca3af" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="submitted" stroke="#6366f1" fillOpacity={1} fill="url(#colorSubmitted)" name="Submitted" />
                  <Area type="monotone" dataKey="skipped" stroke="#9ca3af" fillOpacity={1} fill="url(#colorSkipped)" name="Skipped" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Recent Feedback Logs Table */}
        <div className="flex flex-col gap-3">
          <h4 className="font-bold text-gray-900 text-sm">Recent Feedback Logs</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
              <thead>
                <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase border-b border-gray-200">
                  <th className="py-2.5 px-4">Session ID</th>
                  <th className="py-2.5 px-4">Gender</th>
                  <th className="py-2.5 px-4">Garment</th>
                  <th className="py-2.5 px-4">Feedback</th>
                  <th className="py-2.5 px-4">Score</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {recentFeedback.map((fb: any, idx: number) => (
                  <tr key={fb.id || idx} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-gray-500 font-semibold">{fb.session_id}</td>
                    <td className="py-2.5 px-4 text-gray-700 font-medium">{fb.gender}</td>
                    <td className="py-2.5 px-4 text-gray-800 font-bold">{fb.selected_garment}</td>
                    <td className="py-2.5 px-4 text-xl">{fb.feedback_emoji || "—"}</td>
                    <td className="py-2.5 px-4 font-bold text-amber-500">{fb.feedback_score !== null ? `⭐ ${fb.feedback_score}.0` : "—"}</td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] ${fb.feedback_status === "submitted"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-gray-100 text-gray-500"
                        }`}>
                        {fb.feedback_status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-gray-400 font-semibold">
                      {fb.created_at ? new Date(fb.created_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Most Tried Products Table */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
        <h3 className="font-bold text-gray-900 text-base">Top 5 Most Tried Products & Recommendation Score</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-bold text-gray-400 uppercase">
                <th className="py-3 px-4">Garment Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Try-On Count</th>
                <th className="py-3 px-4">Satisfaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {(feedbackAnalytics?.most_tried_products && feedbackAnalytics.most_tried_products.length > 0) ? (
                feedbackAnalytics.most_tried_products.map((prod: any) => (
                  <tr key={prod.name} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-gray-900">{prod.name}</td>
                    <td className="py-3.5 px-4 text-gray-500 font-medium">{prod.category}</td>
                    <td className="py-3.5 px-4 font-bold text-indigo-600">{prod.tryOns.toLocaleString()}</td>
                    <td className="py-3.5 px-4 text-amber-600 font-semibold">⭐ {prod.rating} / 5.0</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-400">No try-ons recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>


    </div>
  );
}

function UploadGarmentsView() {
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [category, setCategory] = useState("Shirts");
  const [gender, setGender] = useState<"Men" | "Women">("Men");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [price, setPrice] = useState("3999");
  // A URL, not a file upload — staff paste a link to an already-hosted
  // .glb/.gltf. Optional; most garments won't have one yet.
  const [model3dUrl, setModel3dUrl] = useState("");
  // Optional second photo (back view). Mirrors imagePreview exactly. When no
  // real model3dUrl exists, the backend derives a 3D-preview billboard pair
  // from this and the main image automatically.
  const [backImagePreview, setBackImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [garmentsList, setGarmentsList] = useState<Garment[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");

  // Bulk upload: multiple files selected at once, each auto-categorized from
  // its filename (same detectGarmentCategory/detectGarmentGender used for
  // the single-item name field), submitted as a batch. Color/price aren't
  // set per-item -- same "Custom"/3999 defaults the single-upload path uses.
  const [bulkFiles, setBulkFiles] = useState<{ file: File; name: string; category: string; gender: string; preview: string }[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const formatFileNameToTitle = (filename: string) => {
    return filename
      .replace(/\.[^/.]+$/, "") // remove extension
      .replace(/[-_]/g, " ") // replace dashes and underscores with spaces
      .replace(/\b\w/g, (l) => l.toUpperCase()); // title case
  };

  // Live camera capture as an alternative to picking a file, for the front
  // garment photo only -- the separate back-view field below still only
  // takes a file.
  const [showWebcam, setShowWebcam] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const startWebcam = async () => {
    setShowWebcam(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing webcam: ", err);
      setMessage({ text: "Could not access camera. Please allow camera permissions.", type: "error" });
      setShowWebcam(false);
    }
  };

  const stopWebcam = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
    setShowWebcam(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        setImagePreview(dataUrl);
        stopWebcam();
      }
    }
  };

  const fetchCatalog = async () => {
    setLoadingList(true);
    // force: the admin is managing this catalogue and must never act on a
    // cached copy that predates their own upload or delete.
    const list = await getGarments(true);
    setGarmentsList(list);
    setLoadingList(false);
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const handleNameChange = (val: string) => {
    setName(val);
    const autoCat = detectGarmentCategory(val);
    const autoGender = detectGarmentGender(val);
    setGender(autoGender);
    setCategory(autoCat);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (files.length === 1) {
      const file = files[0];
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
      setBulkFiles([]);
      return;
    }

    // Bulk mode: several files selected together
    const processedFiles = await Promise.all(
      files.map(
        (file) =>
          new Promise<{ file: File; name: string; category: string; gender: string; preview: string }>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const title = formatFileNameToTitle(file.name);
              const autoCat = detectGarmentCategory(title);
              const autoGender = detectGarmentGender(title);
              resolve({
                file,
                name: title,
                category: autoCat,
                gender: autoGender,
                preview: reader.result as string
              });
            };
            reader.readAsDataURL(file);
          })
      )
    );
    setBulkFiles(processedFiles);
    setImagePreview(processedFiles[0].preview); // fallback only, bulk mode doesn't render this
  };

  const handleBackImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setBackImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleDelete = async (id: string | number, garmentName: string) => {
    const targetId = String(id);
    setGarmentsList((prev) => prev.filter((g) => String(g.id) !== targetId));
    setMessage({ text: `Garment "${garmentName}" deleted successfully!`, type: "success" });

    const res = await deleteGarment(targetId);
    if (!res.success) {
      setMessage({ text: res.error || "Delete failed", type: "error" });
    }
    fetchCatalog();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (bulkFiles.length > 1) {
      setUploading(true);
      setMessage(null);
      setUploadProgress({ current: 0, total: bulkFiles.length });

      let successCount = 0;
      for (let i = 0; i < bulkFiles.length; i++) {
        const item = bulkFiles[i];
        setUploadProgress({ current: i + 1, total: bulkFiles.length });
        const res = await uploadGarment({
          name: item.name,
          color: "Custom",
          category: item.category,
          gender: item.gender,
          image: item.preview,
          price: 3999
        });
        if (res.success) successCount++;
      }

      setMessage({ text: `Successfully published ${successCount} out of ${bulkFiles.length} garments!`, type: "success" });
      setBulkFiles([]);
      setImagePreview(null);
      setUploadProgress(null);
      setUploading(false);
      fetchCatalog();
      return;
    }

    if (!imagePreview) {
      setMessage({ text: "Please select a garment photo", type: "error" });
      return;
    }

    setUploading(true);
    setMessage(null);

    const res = await uploadGarment({
      name: name.trim() || "Untitled Garment",
      color: color || "Custom",
      category,
      gender,
      image: imagePreview,
      price: price ? Number(price) : 3999,
      model3dUrl: model3dUrl.trim() || undefined,
      backImage: backImagePreview || undefined
    });

    if (res.success) {
      setMessage({ text: `Garment "${name}" saved and categorized under "${category}"!`, type: "success" });
      setName("");
      setColor("");
      setPrice("3999");
      setImagePreview(null);
      setModel3dUrl("");
      setBackImagePreview(null);
      fetchCatalog();
    } else {
      setMessage({ text: res.error || "Upload failed", type: "error" });
    }
    setUploading(false);
  };

  const filteredGarments = garmentsList.filter((g) => {
    const matchesSearch = g.name.toLowerCase().includes(searchQuery.toLowerCase()) || g.color.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === "All" || g.category.toLowerCase() === filterCategory.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="max-w-[1100px] mx-auto mt-[8px] flex flex-col lg:flex-row gap-8">
      {/* Upload Form */}
      <div className="flex-1 flex flex-col gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-5">
          <div>
            <h1 className="font-bold text-gray-900 text-[24px]">Product Catalogue Management</h1>
            <p className="text-gray-500 text-[14px]">Upload garments with automatic category assignment and details.</p>
          </div>

          {message && (
            <div className={`p-4 rounded-xl font-medium text-sm ${message.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {bulkFiles.length > 1 ? (
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                    <Upload className="w-5 h-5" /> Bulk Upload Mode
                  </h3>
                  <span className="text-xs font-semibold bg-indigo-200 text-indigo-800 px-2.5 py-1 rounded-full">
                    {bulkFiles.length} files selected
                  </span>
                </div>
                <p className="text-xs text-indigo-700 font-medium">Names, genders, and categories have been auto-inferred from filenames. Prices default to ₹3999 and color to "Custom".</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto pr-2">
                  {bulkFiles.map((f, i) => (
                    <div key={i} className="bg-white p-2 rounded-xl border border-indigo-100 shadow-sm flex flex-col gap-2">
                      <div className="h-24 w-full bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                        <img src={f.preview} alt={f.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-gray-800 truncate" title={f.name}>{f.name}</span>
                        <span className="text-[9px] font-medium text-gray-500 truncate">{f.gender} • {f.category}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setBulkFiles([])} className="self-start text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
                  Cancel Bulk Upload
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-gray-700">
                    Garment Name (Auto Categorization Active) <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Royal Silk Banarasi Saree, Formal Oxford Shirt, Slim Denim Jeans — leave blank for 'Untitled Garment'"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                  />
                </div>

                {/* Gender Toggle */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-gray-700">Gender Collection</label>
                  <div className="flex rounded-xl border border-gray-300 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => { setGender("Men"); setCategory(MEN_CATEGORIES[0]); }}
                      className={`flex-1 py-2.5 text-sm font-bold transition-colors ${gender === "Men"
                          ? "bg-gray-900 text-white"
                          : "bg-white text-gray-600 hover:bg-gray-100"
                        }`}
                    >
                      👔 Men
                    </button>
                    <button
                      type="button"
                      onClick={() => { setGender("Women"); setCategory(WOMEN_CATEGORIES[0]); }}
                      className={`flex-1 py-2.5 text-sm font-bold transition-colors ${gender === "Women"
                          ? "bg-pink-600 text-white"
                          : "bg-white text-gray-600 hover:bg-gray-100"
                        }`}
                    >
                      👗 Women
                    </button>
                  </div>
                </div>

                {/* Category, Color & Price */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-gray-700">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                    >
                      {(gender === "Women" ? WOMEN_CATEGORIES : MEN_CATEGORIES).map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-gray-700">
                      Color <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Red & Gold, Navy Blue — leave blank for 'Custom'"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-gray-700">
                      Price (Rs.) <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 3999 — leave blank for 3999"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-700">Garment Image</label>
              {showWebcam ? (
                <div className="border-2 border-dashed border-gray-300 rounded-2xl p-4 flex flex-col items-center justify-center bg-gray-900 relative overflow-hidden">
                  <video ref={videoRef} className="w-full max-h-[300px] object-cover rounded-xl bg-black" playsInline autoPlay muted />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute bottom-6 flex gap-4">
                    <button type="button" onClick={stopWebcam} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full text-sm font-semibold shadow-lg transition-colors">
                      Cancel
                    </button>
                    <button type="button" onClick={capturePhoto} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-bold shadow-lg transition-colors flex items-center gap-2">
                      <Camera className="w-4 h-4" /> Capture
                    </button>
                  </div>
                </div>
              ) : (
              <div className="border-2 border-dashed border-gray-300 rounded-2xl p-6 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors relative">
                {imagePreview ? (
                  <div className="flex flex-col items-center gap-3">
                    <img src={imagePreview} alt="Preview" className="h-44 object-contain rounded-lg border shadow-sm bg-white" />
                    <div className="flex gap-3 mt-2">
                      <label className="text-xs font-semibold bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 shadow-sm flex items-center gap-1.5 transition-colors">
                        <Upload className="w-3.5 h-3.5" /> Upload File(s)
                        <input type="file" accept="image/*" multiple onChange={handleImageChange} className="hidden" />
                      </label>
                      <button type="button" onClick={startWebcam} className="text-xs font-semibold bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-1.5 shadow-sm transition-colors">
                        <Camera className="w-3.5 h-3.5" /> Take Photo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 w-full">
                    <div className="flex flex-col items-center gap-2 pointer-events-none">
                      <Upload className="w-9 h-9 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700">Select or Take Garment Photo</span>
                      <span className="text-xs text-gray-400">High Resolution JPG, PNG, WebP</span>
                    </div>
                    <div className="flex gap-3 z-10 relative">
                      <label className="text-sm font-semibold bg-white border border-gray-300 text-gray-700 px-5 py-2.5 rounded-xl cursor-pointer hover:bg-gray-50 shadow-sm flex items-center gap-2 transition-colors">
                        <Upload className="w-4 h-4" /> Upload File(s)
                        <input type="file" accept="image/*" multiple onChange={handleImageChange} className="hidden" />
                      </label>
                      <button type="button" onClick={startWebcam} className="text-sm font-semibold bg-indigo-50 border border-indigo-200 text-indigo-700 px-5 py-2.5 rounded-xl cursor-pointer hover:bg-indigo-100 shadow-sm flex items-center gap-2 transition-colors">
                        <Camera className="w-4 h-4" /> Take Photo
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-md disabled:bg-indigo-300 flex items-center justify-center gap-2 text-sm"
            >
              {uploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>
                    {uploadProgress ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}...` : "Categorizing & Uploading..."}
                  </span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>
                    {bulkFiles.length > 1 ? `Publish ${bulkFiles.length} Garments` : "Publish Garment to Category"}
                  </span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Catalog List with Search & Filter */}
      <div className="w-full lg:w-[420px] flex flex-col gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 text-base">Garments Catalog ({filteredGarments.length})</h2>
            <button onClick={fetchCatalog} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
              <RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search catalog..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs font-medium rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-gray-50 focus:outline-none"
            >
              <option value="All">All Categories</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
            {loadingList ? (
              <p className="text-xs text-gray-400 text-center py-6">Loading garments catalog...</p>
            ) : filteredGarments.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No matching garments found.</p>
            ) : (
              filteredGarments.map((garment) => (
                <div key={garment.id} className="flex items-center gap-3 p-2.5 hover:bg-gray-50 rounded-xl transition-colors border border-gray-100 group">
                  <div className="w-12 h-14 bg-gray-100 rounded-lg overflow-hidden shrink-0 border border-gray-200">
                    <img src={garment.imageUrl} alt={garment.name} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-semibold text-gray-900 text-xs truncate">{garment.name}</span>
                    <span className="text-[11px] text-indigo-600 font-medium capitalize">{garment.category} • {garment.color}</span>
                  </div>
                  {garment.model3dUrl ? (
                    <span
                      title="Has a real 3D model — best quality"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-violet-600 text-[10px] font-bold shrink-0"
                    >
                      <Box className="w-3 h-3" />
                      3D
                    </span>
                  ) : garment.frontCutoutUrl && garment.backCutoutUrl ? (
                    <span
                      title="3D Mannequin preview: front + back photos"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-violet-600 text-[10px] font-bold shrink-0"
                    >
                      <Box className="w-3 h-3" />
                      360°
                    </span>
                  ) : garment.frontCutoutUrl ? (
                    <span
                      title="3D Mannequin preview: front photo only, no back view uploaded"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-600 text-[10px] font-bold shrink-0"
                    >
                      <Box className="w-3 h-3" />
                      Front
                    </span>
                  ) : null}
                  <button
                    onClick={() => handleDelete(garment.id, garment.name)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                    title="Delete Garment"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SecurityView() {
  const API_BASE = (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:5000";

  const [fullScreen, setFullScreen] = useState<boolean>(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Settings State
  const [securityEnabled, setSecurityEnabled] = useState<boolean>(false);
  const [autoMode, setAutoMode] = useState<boolean>(true);
  const [manualOverride, setManualOverride] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const kioskId = "VASTRA_KIOSK_001";
  const mainCam = { id: 1, name: "Main Cam - Store Surveillance", status: "ONLINE", fps: "60 FPS" };

  // Load current security settings
  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("security_settings")
        .select("*")
        .eq("kiosk_id", kioskId)
        .single();

      if (data && !error) {
        setSecurityEnabled(data.security_mode_enabled || false);
        setAutoMode(data.auto_mode_enabled !== false);
        setManualOverride(data.manual_override || false);
      } else {
        // Fallback to local settings API
        const res = await fetch(`${API_BASE}/api/security/settings?kiosk_id=${kioskId}`);
        if (res.ok) {
          const localData = await res.json();
          setSecurityEnabled(localData.security_mode_enabled || false);
          setAutoMode(localData.auto_mode_enabled !== false);
          setManualOverride(localData.manual_override || false);
        }
      }
    } catch (err) {
      console.warn("Supabase load failed, trying local settings fallback...");
      try {
        const res = await fetch(`${API_BASE}/api/security/settings?kiosk_id=${kioskId}`);
        if (res.ok) {
          const localData = await res.json();
          setSecurityEnabled(localData.security_mode_enabled || false);
          setAutoMode(localData.auto_mode_enabled !== false);
          setManualOverride(localData.manual_override || false);
        }
      } catch (localErr) {
        console.error("Local settings load failed too:", localErr);
      }
    } finally {
      setLoading(false);
    }
  };

  const createDefaultSettings = async () => {
    try {
      await supabase
        .from("security_settings")
        .insert({
          kiosk_id: kioskId,
          security_mode_enabled: false,
          auto_mode_enabled: true,
          manual_override: false,
          start_time: "22:00:00",
          end_time: "07:00:00",
          siren_active: false
        });
      await loadSettings();
    } catch (err) {
      console.error("Failed to create default settings: ", err);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Determine if surveillance is active based on schedule or manual override
  const isSurveillanceActive = () => {
    if (!securityEnabled) return false;
    if (manualOverride) return true;
    if (!autoMode) return false;

    // Auto schedule logic: Active 10 PM (22:00) to 7 AM (07:00)
    const now = new Date();
    const currentHour = now.getHours();
    return currentHour >= 22 || currentHour < 7;
  };

  const active = isSurveillanceActive();
  const [sirenActive, setSirenActive] = useState<boolean>(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const detectorRef = React.useRef<SecurityDetector | null>(null);
  const detectionLoopRef = React.useRef<number | null>(null);
  const lastAlertTimeRef = React.useRef<number>(0);

  const captureSnapshot = (): string | null => {
    if (!videoRef.current) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.85);
      }
    } catch (e) {
      console.error("Failed to capture CCTV snapshot:", e);
    }
    return null;
  };

  const playSiren = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(err => console.error("Audio play error:", err));
      setSirenActive(true);
    }
  };

  const stopSiren = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setSirenActive(false);
  };

  const handleStopSiren = async () => {
    stopSiren();
    try {
      await supabase
        .from("security_settings")
        .update({ siren_active: false })
        .eq("kiosk_id", kioskId);

      await fetch(`${API_BASE}/api/security/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kiosk_id: kioskId, siren_active: false })
      });
    } catch (e) {
      console.error("Failed to stop siren in DB:", e);
    }
  };

  useEffect(() => {
    audioRef.current = new Audio(`${import.meta.env.BASE_URL}siren.mp3`);
    audioRef.current.loop = true;
    audioRef.current.preload = "auto";
    detectorRef.current = new SecurityDetector();

    return () => {
      stopSiren();
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setStreamError(null);
      if (detectionLoopRef.current) {
        clearInterval(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
      return;
    }

    let activeStream: MediaStream | null = null;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        activeStream = stream;

        // Start motion detection loop on video frames
        detectionLoopRef.current = window.setInterval(async () => {
          if (videoRef.current && detectorRef.current) {
            try {
              const res = await detectorRef.current.detect(videoRef.current);
              if (res.motionDetected) {
                console.log("CCTV surveillance: Motion detected!");
                playSiren();

                // Update state in DB
                await supabase
                  .from("security_settings")
                  .update({ siren_active: true, siren_triggered_at: new Date().toISOString() })
                  .eq("kiosk_id", kioskId);

                await fetch(`${API_BASE}/api/security/settings`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ kiosk_id: kioskId, siren_active: true })
                });

                // Dispatch Email Alert (throttled to once every 60 seconds)
                const nowMs = Date.now();
                if (nowMs - lastAlertTimeRef.current > 60000) {
                  lastAlertTimeRef.current = nowMs;
                  const snapshot = captureSnapshot();
                  if (snapshot) {
                    fetch(`${API_BASE}/send-alert`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        type: "motion",
                        image: snapshot,
                        timestamp: new Date().toISOString(),
                        make_call: true
                      })
                    }).then(async r => {
                      const alertRes = await r.json();
                      console.log("[CCTV Alert] Dispatch response:", alertRes);
                    }).catch(err => console.error("[CCTV Alert] Failed to send alert API call:", err));
                  }
                }
              }
            } catch (err) {
              console.error("Error in CCTV detection loop: ", err);
            }
          }
        }, 1000);

      } catch (err) {
        console.error("Error accessing webcam for CCTV: ", err);
        setStreamError("Webcam feed not available");
      }
    }
    startCamera();
    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
      if (detectionLoopRef.current) {
        clearInterval(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
    };
  }, [active]);

  const handleToggleManual = async () => {
    setLoading(true);
    setStatusMessage(null);
    const nextState = !securityEnabled;
    const nextOverride = nextState;
    try {
      const { error } = await supabase
        .from("security_settings")
        .upsert({
          kiosk_id: kioskId,
          security_mode_enabled: nextState,
          manual_override: nextOverride,
          auto_mode_enabled: autoMode,
          updated_at: new Date().toISOString()
        }, { onConflict: "kiosk_id" });

      if (error) throw error;

      setSecurityEnabled(nextState);
      setManualOverride(nextOverride);
      setStatusMessage(nextState ? "🟢 Surveillance manually activated!" : "⚪ Surveillance deactivated.");
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.warn("Supabase upsert failed, attempting local fallback...");
      try {
        const res = await fetch(`${API_BASE}/api/security/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kiosk_id: kioskId,
            security_mode_enabled: nextState,
            manual_override: nextOverride,
            auto_mode_enabled: autoMode
          })
        });
        if (res.ok) {
          const resData = await res.json();
          setSecurityEnabled(nextState);
          setManualOverride(nextOverride);
          setStatusMessage(nextState ? "🟢 Surveillance manually activated (Local mode)!" : "⚪ Surveillance deactivated (Local mode).");
        } else {
          throw new Error("Local update failed");
        }
      } catch (localErr) {
        console.error(localErr);
        setStatusMessage("❌ Failed to update settings.");
      }
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAutoMode = async () => {
    setLoading(true);
    setStatusMessage(null);
    const nextAuto = !autoMode;
    const nextOverride = nextAuto ? false : manualOverride;
    try {
      const { error } = await supabase
        .from("security_settings")
        .update({
          auto_mode_enabled: nextAuto,
          manual_override: nextOverride,
          updated_at: new Date().toISOString()
        })
        .eq("kiosk_id", kioskId);

      if (error) throw error;

      setAutoMode(nextAuto);
      setManualOverride(nextOverride);
      setStatusMessage(nextAuto ? "🕐 Auto schedule (10 PM - 7 AM) enabled!" : "⚠️ Auto schedule disabled.");
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.warn("Supabase update failed, attempting local fallback...");
      try {
        const res = await fetch(`${API_BASE}/api/security/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kiosk_id: kioskId,
            auto_mode_enabled: nextAuto,
            manual_override: nextOverride
          })
        });
        if (res.ok) {
          setAutoMode(nextAuto);
          setManualOverride(nextOverride);
          setStatusMessage(nextAuto ? "🕐 Auto schedule (10 PM - 7 AM) enabled (Local mode)!" : "⚠️ Auto schedule disabled (Local mode).");
        } else {
          throw new Error("Local update failed");
        }
      } catch (localErr) {
        console.error(localErr);
        setStatusMessage("❌ Failed to toggle auto mode.");
      }
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setLoading(false);
    }
  };

  const getStatusText = () => {
    if (!securityEnabled) return "Offline (Deactivated)";
    if (manualOverride) return "Online (Manual Override)";
    if (autoMode) {
      return active ? "Online (Auto Schedule)" : "Offline (Outside Schedule: 10 PM - 7 AM)";
    }
    return "Offline";
  };

  const getStatusColor = () => {
    if (!active) return "bg-gray-400";
    if (manualOverride) return "bg-red-500 animate-pulse";
    return "bg-emerald-500 animate-pulse";
  };

  return (
    <div className="max-w-[1100px] mx-auto mt-[8px] flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <h1 className="font-bold text-gray-900 text-[26px]">CCTV Live Surveillance</h1>
          <p className="text-gray-500 text-[14px]">Live camera stream monitoring and security status.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFullScreen(!fullScreen)}
            className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2.5 rounded-xl font-medium text-sm hover:bg-black transition-all shadow-sm"
          >
            <Maximize2 className="w-4 h-4" /> {fullScreen ? "Exit Fullscreen" : "Fullscreen Surveillance"}
          </button>
        </div>
      </div>

      {/* Control Panel Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CCTV Camera Stream */}
        <div className={`${fullScreen ? "fixed inset-0 z-50 bg-black p-6 flex flex-col items-center justify-center" : "w-full"}`}>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm flex flex-col w-full h-full">
            <div className="p-4 bg-gray-900 text-white flex justify-between items-center text-sm font-semibold">
              <span className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
                {mainCam.name} ({getStatusText()})
              </span>
              <div className="flex items-center gap-3">
                {active && <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded text-xs font-mono font-bold">LIVE</span>}
                <span className="bg-gray-800 px-2.5 py-0.5 rounded text-xs text-gray-300 font-mono">{active ? mainCam.fps : "OFFLINE"}</span>
              </div>
            </div>
            <div className={`relative ${fullScreen ? "h-[calc(100vh-140px)]" : "h-[380px] md:h-[420px]"} bg-slate-950 flex items-center justify-center overflow-hidden`}>
              {sirenActive && (
                <div className="absolute inset-0 bg-red-600/30 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-10 animate-pulse">
                  <span className="text-5xl animate-bounce">🚨</span>
                  <p className="text-white text-lg font-bold">INTRUSION DETECTED! SIREN ACTIVE</p>
                  <button
                    onClick={handleStopSiren}
                    className="bg-white text-red-650 px-6 py-2.5 rounded-xl hover:bg-gray-100 font-bold transition-all shadow-lg text-sm"
                  >
                    STOP SIREN / BUZZER
                  </button>
                </div>
              )}
              {!active ? (
                <div className="text-white text-center p-6 space-y-2">
                  <div className="text-4xl text-gray-500">🚫</div>
                  <p className="text-lg font-semibold">Surveillance Offline</p>
                  <p className="text-xs text-gray-400 max-w-xs">
                    The camera feed is deactivated. Turn on Manual Override or wait for the auto-mode schedule (10 PM – 7 AM).
                  </p>
                </div>
              ) : streamError ? (
                <div className="text-white text-center p-4">
                  <p className="text-lg font-semibold mb-1">⚠️ Camera Feed Offline</p>
                  <p className="text-xs text-gray-400">Please connect a camera or verify system permissions.</p>
                </div>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover transform -scale-x-100"
                />
              )}
              {active && (
                <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-mono text-emerald-400 border border-white/10 flex items-center gap-2 shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  REC • {new Date().toLocaleDateString()} LIVE
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Configuration settings panel */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
          <div className="space-y-6">
            <div>
              <h3 className="font-bold text-gray-900 text-lg border-b border-gray-100 pb-2 flex items-center gap-2">
                ⚙️ Security & CCTV Settings
              </h3>
              <p className="text-xs text-gray-400 mt-1">Configure automated scheduling and manual security controls.</p>
            </div>

            {statusMessage && (
              <div className="p-3 bg-indigo-50 border border-indigo-100 text-indigo-900 rounded-xl text-xs font-semibold">
                {statusMessage}
              </div>
            )}

            <div className="space-y-4">
              {/* Manual Enable/Disable */}
              <div className="flex items-center justify-between p-4 bg-gray-55/40 rounded-xl border border-gray-100">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-gray-900">Manual Surveillance Mode</span>
                  <span className="text-[11px] text-gray-400">Force surveillance system ON or OFF instantly.</span>
                </div>
                <button
                  disabled={loading}
                  onClick={handleToggleManual}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-sm ${securityEnabled
                      ? "bg-red-600 hover:bg-red-700 text-white"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white"
                    }`}
                >
                  {securityEnabled ? "Switch OFF" : "Switch ON"}
                </button>
              </div>

              {/* Automatic Mode Timer Toggle */}
              <div className="flex items-center justify-between p-4 bg-gray-55/40 rounded-xl border border-gray-100">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-gray-900">Auto Scheduling (10 PM - 7 AM)</span>
                  <span className="text-[11px] text-gray-400">Automatically activate during night hours.</span>
                </div>
                <button
                  disabled={loading}
                  onClick={handleToggleAutoMode}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-sm ${autoMode
                      ? "bg-indigo-650 bg-indigo-650/10 text-indigo-700 border border-indigo-200"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                >
                  {autoMode ? "Auto: ENABLED" : "Auto: DISABLED"}
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-gray-500 mt-6 space-y-1">
            <div className="flex justify-between">
              <span>Overall Status:</span>
              <span className={`font-bold ${active ? "text-emerald-600" : "text-gray-500"}`}>{getStatusText()}</span>
            </div>
            <div className="flex justify-between">
              <span>Webcam Connection:</span>
              <span className="font-semibold text-gray-800">{active && !streamError ? "STREAMING" : "STANDBY / OFFLINE"}</span>
            </div>
            <div className="flex justify-between">
              <span>Next Auto Transition:</span>
              <span className="font-semibold text-gray-800">10:00 PM (Switch ON)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TechnicalSupportView() {
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [category, setCategory] = useState("AI Model/Try-On");
  const [description, setDescription] = useState("");
  const [remoteSupport, setRemoteSupport] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const fetchTickets = async () => {
    setLoadingTickets(true);
    const data = await getSupportTickets();
    setTickets(data);
    setLoadingTickets(false);
  };

  const fetchDiagnostics = async () => {
    setLoadingDiagnostics(true);
    const diag = await getSystemDiagnostics();
    setDiagnostics(diag);
    setLoadingDiagnostics(false);
  };

  useEffect(() => {
    fetchTickets();
    fetchDiagnostics();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setSuccessBanner(null);

    if (!subject.trim()) {
      setErrorBanner("Please enter a ticket subject.");
      return;
    }
    if (!description.trim()) {
      setErrorBanner("Please enter an issue description or log snippet.");
      return;
    }

    setSubmitting(true);
    const res = await createSupportTicket({
      subject: subject.trim(),
      category,
      priority,
      description: description.trim(),
    });
    setSubmitting(false);

    if (res.success && res.ticket) {
      setSuccessBanner(`Support Ticket #${res.ticket.id} successfully created and assigned to AI Tech Support!`);
      setSubject("");
      setDescription("");
      setTickets((prev) => [res.ticket!, ...prev]);
    } else {
      setErrorBanner(res.error || "Failed to create support ticket. Please try again.");
    }
  };

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    const res = await updateSupportTicketStatus(ticketId, newStatus);
    if (res.success && res.ticket) {
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t))
      );
    }
  };

  const handleDeleteTicket = async (ticketId: string) => {
    if (!window.confirm(`Are you sure you want to delete ticket #${ticketId}?`)) return;
    const res = await deleteSupportTicket(ticketId);
    if (res.success) {
      setTickets((prev) => prev.filter((t) => t.id !== ticketId));
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto mt-[8px] flex flex-col gap-6">
      {/* Header & Remote Assistance */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <h1 className="font-bold text-gray-900 text-[26px]">Technical Support & System Diagnostics</h1>
          <p className="text-gray-500 text-[14px]">Submit error logs, request remote assistance, or manage active tech support tickets.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRemoteSupport(!remoteSupport)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs transition-all ${remoteSupport ? "bg-emerald-600 text-white shadow-md" : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
              }`}
          >
            <ShieldAlert className="w-4 h-4" /> {remoteSupport ? "Remote Session ACTIVE (#VAS-REMOTE-9831)" : "Request Remote Support"}
          </button>
        </div>
      </div>

      {/* Banners */}
      {successBanner && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl text-sm font-semibold flex justify-between items-center shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            <span>{successBanner}</span>
          </div>
          <button onClick={() => setSuccessBanner(null)} className="text-emerald-700 hover:text-emerald-900 font-bold text-xs">✕</button>
        </div>
      )}

      {errorBanner && (
        <div className="p-4 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-sm font-semibold flex justify-between items-center shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600" />
            <span>{errorBanner}</span>
          </div>
          <button onClick={() => setErrorBanner(null)} className="text-rose-700 hover:text-rose-900 font-bold text-xs">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ticket Submission Form */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-5">
          <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-indigo-600" /> Raise Technical Support Ticket
          </h3>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-700 uppercase">Ticket Subject *</label>
              <input
                type="text"
                placeholder="e.g. Try-On vertex prediction delay on Saree upload"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-700 uppercase">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="AI Model/Try-On">AI Model / Try-On</option>
                  <option value="Hardware/Camera">Webcam / Hardware</option>
                  <option value="Network/API">Flask / API Sync</option>
                  <option value="Catalogue">Product Catalogue</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-700 uppercase">Priority Level</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-700 uppercase">Issue Description & Error Log *</label>
              <textarea
                rows={4}
                placeholder="Describe the issue or paste the console output..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Submitting Ticket...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Submit Ticket to Support</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* System Diagnostics */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-emerald-600" /> System Diagnostics
            </h3>
            <button
              onClick={fetchDiagnostics}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
              title="Refresh Diagnostics"
            >
              <RefreshCw className={`w-4 h-4 ${loadingDiagnostics ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="flex flex-col gap-3 text-xs font-medium">
            {(diagnostics?.services || [
              { name: "Vite Frontend UI", status: "Healthy", details: "Port 5173 / 8443" },
              { name: "Flask Server API", status: "Active", details: "Port 5000 Active" },
              { name: "OpenCV Preprocessing", status: "Active", details: "Original Crisp Quality" },
              { name: "Supabase DB Mirror", status: "Synced", details: "Active Connection" }
            ]).map((srv, idx) => (
              <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex justify-between items-center">
                <span className="text-gray-600 font-semibold">{srv.name}</span>
                <span className="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  🟢 {srv.details}
                </span>
              </div>
            ))}
          </div>

          <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex flex-col gap-1 text-xs text-indigo-900 mt-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Flask API Status:</span>
              <span className="font-bold text-indigo-700">{diagnostics ? "ONLINE (200 OK)" : "ONLINE"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Active Garments:</span>
              <span className="font-bold text-indigo-700">{diagnostics?.garmentsCount ?? 12} items</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Python Version:</span>
              <span className="font-bold text-indigo-700">{diagnostics?.pythonVersion || "3.11"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Support Tickets History & Management List */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-gray-900 text-lg">Support Ticket History ({tickets.length})</h3>
            <span className="text-xs bg-indigo-50 text-indigo-700 font-bold px-2.5 py-0.5 rounded-full border border-indigo-200">
              Live Sync
            </span>
          </div>
          <button
            onClick={fetchTickets}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTickets ? "animate-spin" : ""}`} /> Refresh List
          </button>
        </div>

        {loadingTickets ? (
          <p className="text-xs text-gray-400 text-center py-8">Loading support tickets...</p>
        ) : tickets.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">No support tickets found.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {tickets.map((t) => (
              <div key={t.id} className="p-4 bg-gray-50/70 border border-gray-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-gray-300 transition-all">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-xs bg-gray-900 text-white px-2 py-0.5 rounded">{t.id}</span>
                    <span className="font-semibold text-gray-900 text-sm">{t.subject}</span>
                    <span className="text-[11px] font-medium text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">{t.category}</span>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2 mt-1">{t.description}</p>
                  <span className="text-[11px] text-gray-400 mt-1">Submitted on {t.createdAt}</span>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Priority Badge */}
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${t.priority === "Critical" ? "bg-red-50 text-red-700 border-red-200" :
                      t.priority === "High" ? "bg-orange-50 text-orange-700 border-orange-200" :
                        t.priority === "Medium" ? "bg-blue-50 text-blue-700 border-blue-200" :
                          "bg-gray-100 text-gray-700 border-gray-200"
                    }`}>
                    {t.priority}
                  </span>

                  {/* Status Dropdown */}
                  <select
                    value={t.status}
                    onChange={(e) => handleStatusChange(t.id, e.target.value)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border focus:outline-none cursor-pointer ${t.status === "Resolved" ? "bg-emerald-50 text-emerald-700 border-emerald-300" :
                        t.status === "In Progress" ? "bg-amber-50 text-amber-700 border-amber-300" :
                          "bg-indigo-50 text-indigo-700 border-indigo-300"
                      }`}
                  >
                    <option value="Open">Open</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Resolved">Resolved</option>
                  </select>

                  <button
                    onClick={() => handleDeleteTicket(t.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete Ticket"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
