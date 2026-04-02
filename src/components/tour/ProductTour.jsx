import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { tourSteps } from './tourSteps';

export default function ProductTour({ isOpen, onClose }) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const currentStep = tourSteps[currentStepIndex];
  const isLastStep = currentStepIndex === tourSteps.length - 1;

  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
    }
  }, [isOpen]);

  const handleNext = () => {
    if (currentStepIndex < tourSteps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center"
        >
          {/* Backdrop — click closes tour */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
          />

          {/* Tour Card */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep.id}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-2xl w-[480px] max-w-[90vw] overflow-hidden relative z-10"
            >
              {/* Header Image */}
              {currentStep.image && (
                <div className="h-48 w-full relative bg-gray-100">
                  <img
                    src={currentStep.image}
                    alt={currentStep.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-4 left-6 text-white">
                    <div className="flex items-center gap-2 mb-1">
                      {currentStep.icon && <currentStep.icon className="w-5 h-5 text-blue-300" />}
                      <span className="text-sm font-medium text-blue-200 uppercase tracking-wider">
                        STEP {currentStepIndex + 1} OF {tourSteps.length}
                      </span>
                    </div>
                    <h2 className="text-2xl font-bold">{currentStep.title}</h2>
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="p-6">
                {!currentStep.image && (
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold mb-1">{currentStep.title}</h2>
                    <p className="text-sm text-gray-500">Step {currentStepIndex + 1} of {tourSteps.length}</p>
                  </div>
                )}

                <p className="text-gray-600 text-lg leading-relaxed mb-8">
                  {currentStep.description}
                </p>

                {/* Footer / Controls */}
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    Skip Tour
                  </Button>

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={handlePrev}
                      disabled={currentStepIndex === 0}
                      className="w-10 h-10 p-0 rounded-full"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>

                    <Button
                      onClick={handleNext}
                      className="bg-blue-600 hover:bg-blue-700 rounded-full px-6"
                    >
                      {isLastStep ? "Finish" : "Next Feature"}
                      {!isLastStep && <ChevronRight className="w-4 h-4 ml-2" />}
                    </Button>
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                className="absolute top-4 right-4 text-white/80 hover:text-white bg-black/20 hover:bg-black/40 rounded-full p-1 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}