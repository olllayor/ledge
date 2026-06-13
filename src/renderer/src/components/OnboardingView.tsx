import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '@shared/schema';
import {
  IconKeyboard,
  IconShake,
  IconMenuBar,
  IconDrop,
  IconSparkle,
  IconForward,
} from './Icons';

interface OnboardingViewProps {
  state: AppState;
  onComplete(): void;
}

const TOTAL_STEPS = 3;

export function OnboardingView({ state, onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  // Interactive step completion states. Steps 2 and 3 are pure
  // information screens; only step 1 requires the user to actually drop a
  // file before the "Next" button unlocks. The setters for steps 2 and 3
  // are kept (always `true`) so the dev-mode bypass can flip them in
  // sync with step 1.
  const [step1Done, setStep1Done] = useState(false);
  const [step2Done, setStep2Done] = useState(true);
  const [step3Done, setStep3Done] = useState(true);

  // Step 1 interactive states
  const [step1FileDropped, setStep1FileDropped] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const advance = useCallback(() => {
    const isLocked =
      (step === 0 && !step1Done) ||
      (step === 1 && !step2Done) ||
      (step === 2 && !step3Done);

    if (isLocked) {
      return;
    }

    if (step < TOTAL_STEPS - 1) {
      setDirection('forward');
      setStep((s) => s + 1);
    } else {
      void window.ledge.setPreferences({ hasCompletedOnboarding: true });
      onComplete();
    }
  }, [step, step1Done, step2Done, step3Done, onComplete]);

  const goBack = useCallback(() => {
    if (step > 0) {
      setDirection('backward');
      setStep((s) => s - 1);
    }
  }, [step]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Dev-mode bypass: Alt + D instantly completes all steps. Stripped from
      // production builds by Vite's import.meta.env.DEV replacement.
      if (import.meta.env.DEV && event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setStep1Done(true);
        setStep2Done(true);
        setStep3Done(true);
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        advance();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        void window.ledge.setPreferences({ hasCompletedOnboarding: true });
        onComplete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advance, goBack, onComplete]);

  const handleDotClick = (i: number) => {
    if (import.meta.env.DEV && window.event && (window.event as MouseEvent).altKey) {
      // Dev-mode bypass: Alt/Option click unlocks and jumps to that step.
      setStep1Done(true);
      setStep2Done(true);
      setStep3Done(true);
      setStep(i);
    }
  };

  const shortcut = state.preferences.globalShortcut || '⌘⇧Space';

  const currentStepLocked =
    (step === 0 && !step1Done) ||
    (step === 1 && !step2Done) ||
    (step === 2 && !step3Done);

  const getCtaLabel = () => {
    if (step === 0 && !step1Done) {
      return 'Drop File to Unlock';
    }
    if (step === 1 && !step2Done) {
      return 'Perform Shake to Unlock';
    }
    if (step === 2 && !step3Done) {
      return 'Test Shortcut to Unlock';
    }
    return step < TOTAL_STEPS - 1 ? 'Next' : 'Get Started';
  };

  return (
    <main className="onboarding-shell">
      <div className="onboarding-card">
        <div className="onboarding-steps">
          <OnboardingStep
            isActive={step === 0}
            direction={direction}
            index={0}
            total={TOTAL_STEPS}
          >
            <div className="onboarding-illustration">
              <div className="sandbox-drag-container">
                {!step1FileDropped ? (
                  <div
                    className="sandbox-file"
                    draggable="true"
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', 'receipt');
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    data-testid="onboarding-drag-file"
                  >
                    <div className="file-icon-pdf">PDF</div>
                    <span className="file-name">Receipt.pdf</span>
                  </div>
                ) : (
                  <div className="sandbox-file-ghost">
                    <span>Dropped!</span>
                  </div>
                )}

                <div className="flow-arrow mini-arrow">
                  <IconForward />
                </div>

                <div
                  className={`sandbox-shelf${isDragOver ? ' is-drag-over' : ''}${step1FileDropped ? ' has-item' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    setStep1FileDropped(true);
                    setStep1Done(true);
                  }}
                  data-testid="onboarding-drop-shelf"
                >
                  {step1FileDropped ? (
                    <div className="sandbox-shelf-item success-pop">
                      <IconSparkle />
                      <span>Receipt.pdf</span>
                    </div>
                  ) : (
                    <div className="sandbox-shelf-placeholder">
                      <IconDrop />
                      <span>Drop here</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <h2 className="onboarding-title">Your floating shelf</h2>
            <p className="onboarding-copy">
              A fast, temporary workspace for files, folders, snippets, links, and screenshots. Try dragging the <strong>Receipt.pdf</strong> above onto the drop zone to activate the shelf!
            </p>
          </OnboardingStep>

          <OnboardingStep
            isActive={step === 1}
            direction={direction}
            index={1}
            total={TOTAL_STEPS}
          >
            <div className="onboarding-illustration">
              <div className="activation-methods">
                <div className="activation-card">
                  <IconKeyboard />
                  <span className="activation-key">{shortcut}</span>
                  <span className="activation-label">Shortcut</span>
                </div>
                <div className="activation-card">
                  <IconShake />
                  <span className="activation-label">Shake</span>
                </div>
                <div className="activation-card">
                  <IconMenuBar />
                  <span className="activation-label">Menu Bar</span>
                </div>
              </div>
            </div>
            <h2 className="onboarding-title">Three ways to summon it</h2>
            <p className="onboarding-copy">
              Open the shelf anywhere, anytime. Use a keyboard shortcut, shake your cursor while dragging, or click the menu bar icon.
            </p>
          </OnboardingStep>

          <OnboardingStep
            isActive={step === 2}
            direction={direction}
            index={2}
            total={TOTAL_STEPS}
          >
            <div className="onboarding-illustration">
              <div className="drop-flow">
                <div className="flow-item flow-item-in">
                  <IconDrop />
                  <span>Drop in</span>
                </div>
                <div className="flow-arrow">
                  <IconForward />
                </div>
                <div className="flow-item flow-item-out">
                  <IconSparkle />
                  <span>Drag out</span>
                </div>
              </div>
            </div>
            <h2 className="onboarding-title">Drop anything, drag anywhere</h2>
            <p className="onboarding-copy">
              Drop files onto the shelf to collect them. Drag them out to any app. It's that simple.
            </p>
          </OnboardingStep>
        </div>

        <div className="onboarding-footer">
          <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <span
                key={i}
                className={`progress-dot${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
                onClick={() => handleDotClick(i)}
                style={{ cursor: 'pointer' }}
                data-testid={`progress-dot-${i}`}
              />
            ))}
          </div>

          <div className="onboarding-actions">
            {step > 0 ? (
              <button className="onboarding-back" onClick={goBack} type="button">
                Back
              </button>
            ) : (
              <button
                className="onboarding-skip"
                onClick={() => {
                  void window.ledge.setPreferences({ hasCompletedOnboarding: true });
                  onComplete();
                }}
                type="button"
              >
                Skip
              </button>
            )}
            <button
              className={`onboarding-cta${currentStepLocked ? ' is-locked' : ''}`}
              onClick={advance}
              disabled={currentStepLocked}
              type="button"
            >
              {getCtaLabel()}
              {step < TOTAL_STEPS - 1 ? (
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              ) : (
                <IconSparkle />
              )}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

interface OnboardingStepProps {
  isActive: boolean;
  direction: 'forward' | 'backward';
  index: number;
  total: number;
  children: React.ReactNode;
}

function OnboardingStep({ isActive, direction, children }: OnboardingStepProps) {
  return (
    <div
      className={`onboarding-step${isActive ? ' is-active' : ''}${!isActive ? ' is-hidden' : ''}${direction === 'forward' ? ' slide-forward' : ' slide-backward'}`}
      aria-hidden={!isActive}
    >
      {children}
    </div>
  );
}
