import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { markTutorialCompleted } from '@/lib/tutorial';

export interface TutorialStep {
  targetName: string;
  navigateTo: string;
  title: string;
  body: string;
  cta: string;
  tabIndex: number; // 0=Updates,1=Events,2=Circles,3=Profile,4=Chats,5=Mipo
}

const STEPS: TutorialStep[] = [
  {
    targetName: 'tab-circles',
    navigateTo: '/(app)/circles',
    title: 'Meet your friends',
    body: 'Your All Friends circle holds everyone you add. Start by importing contacts.',
    cta: 'Next',
    tabIndex: 2,
  },
  {
    targetName: 'btn-add-circle',
    navigateTo: '/(app)/circles',
    title: 'Build your crew',
    body: 'Create circles for different groups — gym crew, game night pals, hiking buddies.',
    cta: 'Next',
    tabIndex: 2,
  },
  {
    targetName: 'btn-new-event',
    navigateTo: '/(app)/events',
    title: 'Plan something',
    body: 'Tap + to post an event to a circle. Everyone gets notified.',
    cta: 'Next',
    tabIndex: 1,
  },
  {
    targetName: 'tab-mipo',
    navigateTo: '/(app)/mipo',
    title: 'Find each other',
    body: 'Mipo alerts you when friends are nearby — perfect for spontaneous meetups.',
    cta: 'Done',
    tabIndex: 5,
  },
];

interface TutorialContextValue {
  isActive: boolean;
  currentStep: TutorialStep | null;
  currentStepIndex: number;
  registerTarget: (name: string, ref: React.RefObject<View | null>) => void;
  getTarget: (name: string) => React.RefObject<View | null> | undefined;
  advance: () => void;
  skip: () => void;
  start: () => void;
}

const TutorialContext = createContext<TutorialContextValue>({
  isActive: false,
  currentStep: null,
  currentStepIndex: 0,
  registerTarget: () => {},
  getTarget: () => undefined,
  advance: () => {},
  skip: () => {},
  start: () => {},
});

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const targets = useRef<Map<string, React.RefObject<View | null>>>(new Map());

  const registerTarget = useCallback((name: string, ref: React.RefObject<View | null>) => {
    targets.current.set(name, ref);
  }, []);

  const getTarget = useCallback((name: string) => {
    return targets.current.get(name);
  }, []);

  const start = useCallback(() => {
    setStepIndex(0);
    setIsActive(true);
    router.replace(STEPS[0].navigateTo as any);
  }, [router]);

  const advance = useCallback(() => {
    const nextIndex = stepIndex + 1;
    if (nextIndex >= STEPS.length) {
      markTutorialCompleted();
      setIsActive(false);
      return;
    }
    const nextStep = STEPS[nextIndex];
    if (nextStep.navigateTo !== STEPS[stepIndex].navigateTo) {
      router.replace(nextStep.navigateTo as any);
    }
    setStepIndex(nextIndex);
  }, [stepIndex, router]);

  const skip = useCallback(() => {
    markTutorialCompleted();
    setIsActive(false);
  }, []);

  const currentStep = isActive ? STEPS[stepIndex] : null;

  return (
    <TutorialContext.Provider
      value={{ isActive, currentStep, currentStepIndex: stepIndex, registerTarget, getTarget, advance, skip, start }}
    >
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  return useContext(TutorialContext);
}
