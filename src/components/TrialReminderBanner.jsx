import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Gift, X, Calendar, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { trackBeginCheckout } from '@/lib/analytics';

export default function TrialReminderBanner({ user, myCompany }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!myCompany || !user || dismissed) return null;

  // Don't show for legacy unlimited accounts
  if (myCompany.id === 'companysync_master_001' || 
      myCompany.company_name?.includes('Insurance Claims Network')) {
    return null;
  }

  // Show for trial or expired status
  if (myCompany.subscription_status !== 'trial' && myCompany.subscription_status !== 'expired') return null;

  // Calculate days remaining
  // trial_ends_at (action-started trials) with fallback to the trial_end_date
  // column (Stripe/signup trials) so the banner agrees with the access gates.
  const trialEndRaw = myCompany.trial_ends_at || myCompany.trial_end_date || null;
  const trialEndDate = trialEndRaw ? new Date(trialEndRaw) : null;
  if (!trialEndDate) return null;

  const today = new Date();
  const daysRemaining = Math.ceil((trialEndDate - today) / (1000 * 60 * 60 * 24));
  const isExpired = daysRemaining < 0 || myCompany.subscription_status === 'expired';

  // Don't show if more than 10 days left (and not expired)
  if (daysRemaining > 10 && !isExpired) return null;

  const handleAddCard = async () => {
    // Map plan names to Stripe price IDs — 'trial'/null both fall back to basic
    const priceMap = {
      basic:      'price_1T5NV8CAqGydUaCs2iO0R9yl',
      freelance:  'price_1T5NV8CAqGydUaCs2iO0R9yl',
      trial:      'price_1T5NV8CAqGydUaCs2iO0R9yl',
      business:   'price_1T5NV8CAqGydUaCsJ8SDQSnx',
      enterprise: 'price_1T5NV8CAqGydUaCs1kPhAuWo',
    };
    const priceId = priceMap[myCompany.subscription_plan] || priceMap.basic;

    setLoading(true);
    try {
      const response = await base44.functions.invoke('createCheckoutSession', {
        priceId,
        mode: 'subscription',
        companyId: myCompany.id,
        planName: myCompany.subscription_plan,
        metadata: { extend_trial: '7' }
      });

      if (response.error) {
        alert('Checkout failed: ' + response.error);
        return;
      }
      const url = response.data?.url || response.url;
      const sessionId = response.data?.id || response.id;
      if (url) {
        await trackBeginCheckout({
          sessionId,
          plan: myCompany.subscription_plan,
        });
        window.location.href = url;
      } else {
        alert('No checkout URL returned — please try again or contact support.');
      }
    } catch (error) {
      alert('Checkout failed: ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Alert className={`${isExpired ? 'bg-gradient-to-r from-red-50 to-orange-50 border-red-400' : 'bg-gradient-to-r from-purple-50 to-pink-50 border-purple-300'} mb-6 relative`}>
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
      >
        <X className="w-4 h-4" />
      </button>
      
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 ${isExpired ? 'bg-gradient-to-br from-red-500 to-orange-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'} rounded-full flex items-center justify-center flex-shrink-0`}>
          {isExpired ? <CreditCard className="w-6 h-6 text-white" /> : <Gift className="w-6 h-6 text-white" />}
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-bold text-lg text-gray-900">
              {isExpired 
                ? '🚫 Your Trial Has Expired - Subscribe to Continue' 
                : '🎁 Get 7 Extra Trial Days - FREE!'}
            </h3>
            <Badge className={isExpired ? 'bg-red-600 text-white' : 'bg-red-500 text-white'}>
              {isExpired ? 'Expired' : 'Limited Time'}
            </Badge>
          </div>
          
          <AlertDescription className="text-gray-700 mb-4">
            {isExpired ? (
              <p className="mb-2">
                <strong>Your free trial ended on {trialEndDate.toLocaleDateString()}.</strong> Your data is safe, but features are limited. Add your payment details now to get <strong className="text-purple-600">7 extra days FREE</strong> before your subscription starts!
              </p>
            ) : (
              <p className="mb-2">
                <strong>Your trial ends in {daysRemaining} day{daysRemaining !== 1 ? 's' : ''}.</strong> Add your payment details now and we'll extend your trial by <strong className="text-purple-600">7 extra days</strong> - completely FREE!
              </p>
            )}
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4 text-purple-600" />
                {isExpired ? 'Get 7 days from today' : `Trial extended to ${new Date(trialEndDate.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}`}
              </span>
              <span className="text-gray-600">• No charge until trial ends</span>
              <span className="text-gray-600">• Cancel anytime</span>
            </div>
          </AlertDescription>

          <div className="flex gap-3">
            <Button 
              onClick={handleAddCard}
              disabled={loading}
              className={isExpired 
                ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700' 
                : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'}
            >
              {loading
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <CreditCard className="w-4 h-4 mr-2" />}
              {loading ? 'Opening checkout…' : isExpired ? 'Subscribe Now & Get 7 Free Days' : 'Add Payment & Get 7 Free Days'}
            </Button>
            {!isExpired && (
              <Button 
                variant="outline"
                onClick={() => setDismissed(true)}
              >
                Remind Me Later
              </Button>
            )}
          </div>
        </div>
      </div>
    </Alert>
  );
}