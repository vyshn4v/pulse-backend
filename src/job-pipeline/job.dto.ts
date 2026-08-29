export class CreateJobDto {
  company: string;
  role: string;
  status?: string; // applied, interview, offer, rejected
  appliedAt?: string;
  source?: string; // Wellfound, Cutshort, Instahyre, YC India, Naukri, LinkedIn, Referral, Other
  jobLink?: string;
  salaryRange?: string;
  notes?: string;
  hrName?: string;
  hrEmail?: string;
  hrPhone?: string;
  hrDetailsId?: number;
}

export class UpdateJobDto {
  company?: string;
  role?: string;
  status?: string;
  appliedAt?: string;
  source?: string;
  jobLink?: string;
  salaryRange?: string;
  notes?: string;
  hrName?: string;
  hrEmail?: string;
  hrPhone?: string;
  hrDetailsId?: number;
}
