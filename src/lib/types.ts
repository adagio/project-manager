export interface Category {
  id: string;
  label: string;
  color: string;
}

export interface Project {
  id: string;
  name: string;
  category: string;
  company?: string;
  path: string;
  repoUrl?: string;
  baseBranch?: string;
  awPatterns?: string[];
  historySlug?: string;
  tabColor?: string;
}

export interface ProjectRegistry {
  categories: Category[];
  projects: Project[];
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitStatus {
  branch: string;
  baseBranch: string | null;
  ahead: number;
  behind: number;
  aheadOfBase: number;
  behindBase: number;
  modified: number;
  untracked: number;
  lastCommitDate: string | null;
  lastCommitMessage: string | null;
  isRepo: boolean;
}

export interface HistoryEntry {
  command: string;
  lineNumber: number;
}

export interface ProjectSummary {
  project: Project;
  category: Category;
  git: GitStatus | null;
  recentCommands: number;
}

// Computed financial types (not stored in DB)
export interface ProjectFinancials {
  projectId: string;
  totalHours: number;
  effectiveRate: number;
  earnedAmount: number;
  fixedAmount: number;
  invoicedAmount: number;
  paidAmount: number;
  pendingAmount: number;
}

export interface IncomeReport {
  period: { from: string; to: string };
  byProject: ProjectFinancials[];
  totalEarned: number;
  totalFixed: number;
  totalPaid: number;
  totalPending: number;
}

// ---- Claude Code Activity ----

export interface ClaudePrompt {
  display: string;
  timestamp: number;       // ms epoch
  project: string;         // full Windows path
  sessionId: string;
}

export interface ClaudeSessionSummary {
  sessionId: string;
  promptCount: number;
  firstPrompt: number;    // timestamp ms
  lastPrompt: number;     // timestamp ms
}

export interface ClaudeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ClaudeSessionDetail extends ClaudeSessionSummary {
  tokens: ClaudeTokenUsage;
  models: Record<string, number>;
}

export interface ClaudeProjectSummary {
  projectId: string;
  projectName: string;
  promptCount: number;
  sessionCount: number;
  lastActivity: number;
}

export interface ClaudeDailyActivity {
  date: string;  // YYYY-MM-DD
  promptCount: number;
}

export interface ClaudeGlobalSummary {
  totalPrompts: number;
  totalSessions: number;
  mostActiveProject: { id: string; name: string; promptCount: number } | null;
  dailyActivity: ClaudeDailyActivity[];
  byProject: ClaudeProjectSummary[];
  unregisteredPrompts: number;
}
