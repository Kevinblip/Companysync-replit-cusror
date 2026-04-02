import React, { useRef, useState } from "react";
import { motion, useMotionValue, useAnimation } from "framer-motion";
import { Phone, Mail, MessageCircle, Trash2, ChevronLeft } from "lucide-react";

export default function SwipeableCard({ 
  children, 
  onCall, 
  onEmail, 
  onSMS, 
  onDelete,
  className = ""
}) {
  const [isDragging, setIsDragging] = useState(false);
  const x = useMotionValue(0);
  const controls = useAnimation();

  // Calculate how many action buttons we have
  const actionCount = [onCall, onSMS, onEmail, onDelete].filter(Boolean).length;
  const swipeDistance = Math.min(actionCount * 70 + 10, 290);

  const handleDragEnd = (event, info) => {
    setIsDragging(false);
    const threshold = -60;
    
    if (info.offset.x < threshold) {
      // Swiped left - show action menu
      controls.start({ x: -swipeDistance });
    } else {
      // Reset
      controls.start({ x: 0 });
    }
  };

  const handleActionClick = (action) => {
    if (action) action();
    controls.start({ x: 0 });
  };

  return (
    <div className="relative overflow-hidden rounded-lg mb-3 bg-gray-100">
      {/* Action Buttons Background */}
      <div className="absolute right-0 top-0 bottom-0 flex items-center justify-end gap-2 pr-3" style={{ width: swipeDistance }}>
        {onCall && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(onCall);
            }}
            className="w-16 h-16 bg-green-500 rounded-xl flex items-center justify-center text-white shadow-lg hover:bg-green-600 active:bg-green-700 transition-colors"
            title="Call"
          >
            <Phone className="w-7 h-7" />
          </button>
        )}
        {onSMS && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(onSMS);
            }}
            className="w-16 h-16 bg-purple-500 rounded-xl flex items-center justify-center text-white shadow-lg hover:bg-purple-600 active:bg-purple-700 transition-colors"
            title="Send SMS"
          >
            <MessageCircle className="w-7 h-7" />
          </button>
        )}
        {onEmail && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(onEmail);
            }}
            className="w-16 h-16 bg-blue-500 rounded-xl flex items-center justify-center text-white shadow-lg hover:bg-blue-600 active:bg-blue-700 transition-colors"
            title="Send Email"
          >
            <Mail className="w-7 h-7" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(onDelete);
            }}
            className="w-16 h-16 bg-red-500 rounded-xl flex items-center justify-center text-white shadow-lg hover:bg-red-600 active:bg-red-700 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-7 h-7" />
          </button>
        )}
      </div>

      {/* Card Content (swipeable horizontally only) */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -swipeDistance, right: 0 }}
        dragElastic={0.2}
        dragMomentum={false}
        dragDirectionLock={true}
        style={{ x }}
        animate={controls}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        className={`${className} bg-white relative z-10 touch-pan-y`}
      >
        {/* Swipe Hint Indicator */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
          <ChevronLeft className="w-5 h-5 animate-pulse" />
        </div>
        
        {children}
      </motion.div>
    </div>
  );
}