import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mail, CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const resp = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setSent(true);
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex" data-testid="forgot-password-page">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 p-12 flex-col justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">CompanySync</h1>
          <p className="text-blue-200 mt-1 text-sm">Roofing Business Management</p>
        </div>
        <div className="space-y-6">
          <h2 className="text-4xl font-serif font-bold text-white leading-tight">
            Run your roofing business<br />smarter, not harder.
          </h2>
          <p className="text-blue-200 text-lg max-w-md leading-relaxed">
            CRM, estimates, invoicing, crew management, AI damage inspection, and more — all in one platform.
          </p>
        </div>
        <p className="text-blue-300/60 text-xs">&copy; {new Date().getFullYear()} CompanySync</p>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-900">CompanySync</h1>
            <p className="text-slate-500 text-sm">Roofing Business Management</p>
          </div>

          {sent ? (
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Check Your Email</h2>
                <p className="text-slate-500 mt-2 text-sm">
                  If <strong>{email}</strong> is registered, we sent a link to set your password. Check your inbox (and spam folder).
                </p>
              </div>
              <p className="text-slate-400 text-xs">The link expires in 1 hour.</p>
              <Link to="/login" className="block text-blue-600 hover:text-blue-700 font-medium text-sm">
                ← Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-slate-900">Forgot Password?</h2>
                <p className="text-slate-500 mt-2 text-sm">
                  Enter your email and we'll send you a link to set your password. This also works if you were invited as a staff member.
                </p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="pl-10"
                      data-testid="input-forgot-email"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                  data-testid="button-forgot-submit"
                >
                  {isSubmitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </form>

              <div className="text-center text-sm text-slate-500">
                Remembered your password?{" "}
                <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium" data-testid="link-back-login">
                  Sign In
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
