export class UpdateMeDto {
  whoAmI?: string;
  goals?: string;
  leetcodeUsername?: string;
  mediumUsername?: string;
  brainBehaviorPrefs?: {
    sprintStyle?: 'aggressive' | 'balanced' | 'sustainable';
    focusDomains?: string[];
    primaryFocus?: string;
    tone?: 'direct' | 'encouraging' | 'analytical';
    dailyTaskCap?: number;
    externalHandles?: {
      leetcode?: string;
      github?: string;
      linkedin?: string;
      medium?: string;
    };
    [key: string]: any;
  };
}
