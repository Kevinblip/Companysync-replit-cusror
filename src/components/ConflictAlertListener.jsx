import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { AlertCircle } from 'lucide-react';

export default function ConflictAlertListener({ user, notifications = [] }) {
  const lastNotificationId = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    // Check for new conflict notifications
    const conflictNotifications = notifications.filter(n => 
      n.title?.includes('CONFLICT') || n.title?.includes('SCHEDULING CONFLICT')
    );

    if (conflictNotifications.length > 0) {
      const latestConflict = conflictNotifications[0];
      
      // Only alert if this is a NEW notification we haven't seen
      if (latestConflict.id !== lastNotificationId.current) {
        lastNotificationId.current = latestConflict.id;
        
        // Play alert sound
        playAlertSound();
        
        // Show toast notification with sound
        toast.error(latestConflict.title, {
          description: latestConflict.message,
          duration: 10000, // Show for 10 seconds
          action: {
            label: 'View Calendar',
            onClick: () => {
              window.location.href = latestConflict.link_url || '/calendar';
            }
          },
          icon: <AlertCircle className="w-5 h-5 text-red-600" />,
        });
      }
    }
  }, [notifications]);

  const playAlertSound = () => {
    // Create audio element if it doesn't exist
    if (!audioRef.current) {
      audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBCl+zfLTgjMGHm7A7+OZRQ0PVKvi7KxiHQU2kd7xyXkpBSl+zPLUgzQHIXLD79yVRQ8PVKvi7K1jHgU4k9/yx3coByl8y/PUgjQHI3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw8RVq3i66xiHgU5k+Hyx3coByl8y/PVgzUII3LE8NySQw==');
    }
    
    if (audioRef.current) {
      audioRef.current.volume = 0.5;
      audioRef.current.play().catch(e => console.log('Audio play failed:', e));
    }
  };

  return null; // This component doesn't render anything visible
}