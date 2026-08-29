export class UpdateLeetCodeConfigDto {
  username: string;
}

export class CreateManualSubmissionDto {
  title: string;
  titleSlug?: string;
  difficulty: string; // Easy, Medium, Hard
  status?: string; // Accepted, etc.
  language?: string;
  notes?: string;
  topics?: string[];
  timestamp?: string;
}

export class UpdateSubmissionNotesDto {
  notes: string;
}
