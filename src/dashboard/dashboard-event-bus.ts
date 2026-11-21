import { Injectable } from "@nestjs/common";

export type DiaryChangedEvent = {
  userId: number;
  dateKey: string;
  allDates?: true;
};

export type DiaryChangedListener = (event: DiaryChangedEvent) => void;

@Injectable()
export class DashboardEventBus {
  private readonly listeners = new Set<DiaryChangedListener>();

  onDiaryChanged(listener: DiaryChangedListener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: DiaryChangedListener): void {
    this.listeners.delete(listener);
  }

  emitDiaryChanged(userId: number, dateKey: string, options?: { allDates: true }): void {
    const event: DiaryChangedEvent = { userId, dateKey, ...options };
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Swallow listener errors — don't crash the emit
      }
    });
  }
}
