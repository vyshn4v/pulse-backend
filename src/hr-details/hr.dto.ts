export class CreateHRDto {
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  notes?: string;
}

export class UpdateHRDto {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
}
