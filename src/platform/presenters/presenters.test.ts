/**
 * The presenter stores and the web entry points routed to them: the web's showContextMenu /
 * openReportDialog / openUserProfilePopover present the mobile sheets, and the report form keeps
 * the web dialog's rules.
 */
import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import i18next from 'i18next';
import { ApiError } from '@web/api/ApiError';

const mockCreateReport = jest.fn((_input: Record<string, unknown>) => Promise.resolve({}));

jest.mock('@web/api/reports', () => ({ createReport: (input: Record<string, unknown>) => mockCreateReport(input) }));
jest.mock('@web/api/instance', () => ({
  REPORT_REASONS: ['spam', 'harassment', 'hate', 'sexual', 'violence', 'illegal', 'impersonation', 'other'],
}));
jest.mock('@web/stores/auth', () => ({ auth: { user: { id: '100' } } }));
jest.mock('@web/stores/rooms', () => ({
  rooms: { rooms: [{ id: '7', type: 2, name: 'Weekend plans' }] },
  roomDisplayName: (r: { name: string }) => r.name,
}));
jest.mock('@web/stores/spaces', () => ({ spaces: { spaceRoomsBySpaceId: { '50': [{ id: '3', name: 'general' }] } } }));
jest.mock('@web/lib/userProfilePopoverHelpers', () => ({
  popoverSubjectFromParticipant: (p: { id: string; username: string }) => ({ userId: p.id, username: p.username, displayName: p.username }),
}));

// No strings loaded: t() answers with the key, which is what the assertions compare.
beforeAll(async () => {
  await i18next.init({ lng: 'en', initAsync: false, resources: { en: { translation: {} } } });
});

const sheet = require('./actionSheet') as typeof import('./actionSheet');
const contextMenu = require('../overrides/stores/contextMenu') as typeof import('../overrides/stores/contextMenu');
const report = require('./reportSheet') as typeof import('./reportSheet');
const reportDialog = require('../overrides/components/ReportDialog') as typeof import('../overrides/components/ReportDialog');
const profile = require('./profileSheet') as typeof import('./profileSheet');
const popover = require('../overrides/stores/userProfilePopover') as typeof import('../overrides/stores/userProfilePopover');

describe('action sheet', () => {
  beforeEach(() => sheet.dismissActionSheet());

  it('closes before running the chosen action, so the action can present another sheet', () => {
    const second = { label: 'Second', onClick: jest.fn() };
    const first = { label: 'First', onClick: jest.fn(() => sheet.presentActionSheet([second], { title: 'Next' })) };
    sheet.presentActionSheet([first], { title: 'Alice' });
    expect(sheet.actionSheet()).toMatchObject({ open: true, title: 'Alice', items: [first] });
    sheet.selectActionSheetItem(0);
    expect(first.onClick).toHaveBeenCalledTimes(1);
    expect(sheet.actionSheet()).toMatchObject({ open: true, title: 'Next', items: [second] });
  });

  it('ignores disabled items and taps after dismissal', () => {
    const disabled = { label: 'No', onClick: jest.fn(), disabled: true };
    const ok = { label: 'Yes', onClick: jest.fn() };
    sheet.presentActionSheet([disabled, ok]);
    sheet.selectActionSheetItem(0);
    expect(disabled.onClick).not.toHaveBeenCalled();
    expect(sheet.actionSheet().open).toBe(true);
    sheet.dismissActionSheet();
    sheet.selectActionSheetItem(1);
    expect(ok.onClick).not.toHaveBeenCalled();
  });

  it('presents nothing for an empty list and bumps the key per presentation', () => {
    sheet.presentActionSheet([]);
    expect(sheet.actionSheet().open).toBe(false);
    const k = sheet.actionSheet().key;
    sheet.presentActionSheet([{ label: 'a', onClick: () => undefined }]);
    expect(sheet.actionSheet().key).toBe(k + 1);
  });

  it('maps Font Awesome classes to glyph names', () => {
    expect(sheet.actionSheetIconName('fa-copy')).toBe('copy');
    expect(sheet.actionSheetIconName('fa-solid fa-flag')).toBe('flag');
    expect(sheet.actionSheetIconName(undefined)).toBeUndefined();
  });

  it("receives the web's showContextMenu, with or without an event", () => {
    const item = { label: 'Copy', onClick: () => undefined };
    const ev = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    contextMenu.showContextMenu(ev, [item]);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(contextMenu.contextMenuState()).toEqual({ open: true, x: 0, y: 0, items: [item] });
    contextMenu.closeContextMenu();
    expect(contextMenu.contextMenuState().open).toBe(false);
    contextMenu.showContextMenu([item]);
    expect(sheet.actionSheet().open).toBe(true);
  });
});

describe('report sheet', () => {
  beforeEach(() => {
    mockCreateReport.mockReset();
    mockCreateReport.mockImplementation(() => Promise.resolve({}));
    report.dismissReportSheet();
  });

  it('opens from the web openReportDialog with an empty form', () => {
    reportDialog.openReportDialog({ targetType: 'user', targetId: '200', targetName: 'Alice', roomId: '7', messageId: '9', messageText: 'hi' });
    expect(report.reportSheet.subject?.targetId).toBe('200');
    expect(report.reportSheet).toMatchObject({ reason: '', details: '', busy: false, sent: false, error: '' });
    expect(report.reportRoomLabel()).toBe('Weekend plans');
    expect(report.canPasteReportMessage()).toBe(true);
    report.pasteReportMessage();
    expect(report.reportSheet.details).toBe('hi');
    expect(report.canPasteReportMessage()).toBe(false);
  });

  it('names a space room from its space', () => {
    report.presentReportSheet({ targetType: 'user', targetId: '200', targetName: 'Bob', spaceId: '50', roomId: '3', messageId: '1' });
    expect(report.reportRoomLabel()).toBe('general');
  });

  it('needs a reason, then files exactly what the web dialog files', async () => {
    report.presentReportSheet({ targetType: 'space', targetId: '50', targetName: 'Home', spaceId: '50' });
    await expect(report.submitReport()).resolves.toBe(false);
    expect(mockCreateReport).not.toHaveBeenCalled();

    report.setReportReason('spam');
    report.setReportDetails('  lots of ads  ');
    await expect(report.submitReport()).resolves.toBe(true);
    expect(mockCreateReport).toHaveBeenCalledWith({
      target_type: 'space',
      target_id: '50',
      space_id: '50',
      room_id: undefined,
      message_id: undefined,
      reason: 'spam',
      details: 'lots of ads',
    });
    expect(report.reportSheet).toMatchObject({ busy: false, sent: true });
  });

  it('explains a duplicate or a rate limit, and refuses to close mid-submit', async () => {
    report.presentReportSheet({ targetType: 'user', targetId: '200', targetName: 'Alice' });
    report.setReportReason('harassment');
    let reject!: (e: unknown) => void;
    mockCreateReport.mockImplementation(() => new Promise((_res, rej) => (reject = rej)));
    const pending = report.submitReport();
    expect(report.reportSheet.busy).toBe(true);
    expect(report.dismissReportSheet()).toBe(false);
    reject(new ApiError('conflict', 409));
    await expect(pending).resolves.toBe(false);
    expect(report.reportSheet).toMatchObject({ busy: false, sent: false, error: 'report.duplicate' });

    mockCreateReport.mockImplementation(() => Promise.reject(new ApiError('slow down', 429)));
    await report.submitReport();
    expect(report.reportSheet.error).toBe('report.tooMany');

    mockCreateReport.mockImplementation(() => Promise.reject(new Error('offline')));
    await report.submitReport();
    expect(report.reportSheet.error).toBe('report.failed');
    expect(report.dismissReportSheet()).toBe(true);
    expect(report.reportSheet.subject).toBeNull();
  });
});

describe('profile sheet', () => {
  it("presents from the web's open functions, ignoring the anchor", () => {
    const onMessageUser = jest.fn();
    popover.openUserProfilePopover({
      anchor: {},
      subject: { userId: '200', username: 'alice', displayName: 'Alice' },
      currentUserId: '100',
      onMessageUser,
    });
    expect(profile.profileSheet).toMatchObject({ open: true, currentUserId: '100', spaceRoleContext: null });
    expect(popover.userProfilePopover.subject?.userId).toBe('200');
    popover.closeUserProfilePopover();
    expect(profile.profileSheet).toMatchObject({ open: false, subject: null });

    popover.openUserProfileFromParticipant({ participant: { id: '300', username: 'bob' } as never, anchor: null });
    expect(profile.profileSheet.subject).toMatchObject({ userId: '300', username: 'bob' });
    profile.dismissProfileSheet();
  });
});
