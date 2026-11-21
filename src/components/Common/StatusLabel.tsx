import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, PauseCircle, Sparkles, UserCheck } from 'lucide-react';
import type { BookingStatus, LeadStatus, WorkflowStatus } from '../../types/paperflow';

export function formatPhp(amount: number): string {
  return `₱${amount.toLocaleString('en-PH')}`;
}

export function formatShortTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatShortDate(isoOrYmd: string): string {
  try {
    const date = new Date(isoOrYmd.includes('T') ? isoOrYmd : `${isoOrYmd}T00:00:00`);
    return date.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoOrYmd;
  }
}

export function LeadStatusText({ status }: { status: LeadStatus }) {
  const styles: Record<LeadStatus, string> = {
    'New Inquiry': 'text-pink-700 dark:text-pink-300',
    Qualified: 'text-sky-700 dark:text-sky-300',
    'Proposal Sent': 'text-indigo-700 dark:text-indigo-300',
    Booked: 'text-emerald-700 dark:text-emerald-400',
    'Needs Handoff': 'text-amber-700 dark:text-amber-400',
    Archived: 'text-slate-500 dark:text-slate-400',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${styles[status]}`}>
      {status === 'Booked' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'Needs Handoff' && <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'New Inquiry' && <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'Qualified' && <UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'Proposal Sent' && <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span>{status}</span>
    </span>
  );
}

export function BookingStatusText({ status }: { status: BookingStatus }) {
  const styles: Record<BookingStatus, string> = {
    Confirmed: 'text-emerald-700 dark:text-emerald-400',
    'Pending Deposit': 'text-amber-700 dark:text-amber-400',
    Completed: 'text-slate-700 dark:text-slate-300',
    Cancelled: 'text-rose-700 dark:text-rose-400',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${styles[status]}`}>
      {status === 'Confirmed' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'Pending Deposit' && <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'Completed' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'Cancelled' && <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span>{status}</span>
    </span>
  );
}

export function WorkflowStatusText({ status }: { status: WorkflowStatus }) {
  const styles: Record<WorkflowStatus, string> = {
    Active: 'text-emerald-700 dark:text-emerald-400',
    Paused: 'text-amber-700 dark:text-amber-400',
    Draft: 'text-slate-500 dark:text-slate-400',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${styles[status]}`}>
      {status === 'Active' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'Paused' && <PauseCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {status === 'Draft' && <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span>{status}</span>
    </span>
  );
}

export function AvatarMonogram({
  initials,
  tone,
  imageUrl,
  alt,
}: {
  initials: string;
  tone: 'pink' | 'navy' | 'slate' | 'rose';
  imageUrl?: string;
  alt?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [imageUrl]);

  const classes = {
    pink: 'bg-pink-100 text-pink-900 dark:bg-pink-950/60 dark:text-pink-200',
    navy: 'bg-[#0F172A] text-white dark:bg-slate-800 dark:text-slate-100',
    slate: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    rose: 'bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-200',
  }[tone];

  const safeImageUrl =
    imageUrl && imageUrl.startsWith('https://') && !imgFailed ? imageUrl : null;

  if (safeImageUrl) {
    return (
      <img
        src={safeImageUrl}
        alt={alt ? `${alt} profile photo` : ''}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="h-9 w-9 shrink-0 rounded-xl object-cover border border-[#E7E4ED] dark:border-slate-700"
      />
    );
  }

  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold tracking-tight ${classes}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
