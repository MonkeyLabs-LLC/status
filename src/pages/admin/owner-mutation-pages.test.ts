import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const adminRoot = fileURLToPath(new URL('.', import.meta.url));

function page(path: string): string {
  return readFileSync(`${adminRoot}/${path}`, 'utf8');
}

describe('admin incident and maintenance owner mutation pages', () => {
  it('declares incidents through the owner workflow without a quorum or database fallback', () => {
    const source = page('incidents/new.astro');
    const owner = source.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(owner).toContain("newOwnerCommand('open'");
    expect(owner).toContain('publishIncidentCommand(command');
    expect(owner).toContain('ownerIncident(declaredIncidentID(result.monitor))');
    expect(owner).toContain('author: who');
    expect(owner).not.toMatch(/\bdb\.|recordManualOverride|getManualSource/);
    expect(source).toContain('Title, customer message, and at least one affected component are required.');
    expect(source).toContain('is not a leaf (declare on a service or host).');
    expect(source).toContain('return Astro.redirect(`/admin/incidents/${encodeURIComponent(opened.incident.id)}`)');
  });

  it('routes every incident-detail mutation and read through the selected owner', () => {
    const source = page('incidents/[id].astro');
    const owner = source.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(owner).toContain("newOwnerCommand('edit'");
    expect(owner).toContain("newOwnerCommand('update'");
    expect(owner).toContain('resolveOwnedIncident(owned.incident');
    expect(owner).toContain('publishIncidentCommand(command');
    expect(owner).not.toMatch(/\bdb\.|recordManualOverride|getManualSource/);
    expect(source).toContain("const ALLOWED_STATUS = ['investigating', 'identified', 'monitoring', 'resolved'];");
    expect(source).toContain('return Astro.redirect(`/admin/incidents/${encodeURIComponent(id)}`)');
  });

  it('schedules maintenance through the owner transition workflow and keeps legacy notification isolated', () => {
    const source = page('maintenance/new.astro');
    const owner = source.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(source).toContain('ownerMaintenanceProjection()');
    expect(source).not.toMatch(/from ['"]@\/db|from ['"]@\/lib\/(?:quorum|notify)/);
    expect(owner).toContain("kind: 'schedule_maintenance'");
    expect(owner).toContain('sendOwnerMaintenanceCommand({');
    expect(owner).not.toMatch(/\bdb\.|notifyMaintenance/);
    expect(source).toContain('All fields are required, including at least one affected component.');
    expect(source).toContain('Unknown or non-leaf component');
    expect(source).toContain("return Astro.redirect('/admin/maintenance')");
  });

  it('edits, deletes, and reads maintenance through the owner with no mutation fallback', () => {
    const source = page('maintenance/[id].astro');
    const owner = source.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(owner).toContain("kind: 'delete_maintenance'");
    expect(owner).toContain("kind: 'edit_maintenance'");
    expect(owner).toContain('sendOwnerMaintenanceCommand({');
    expect(owner).not.toMatch(/\bdb\./);
    expect(source).toContain("error = 'All fields are required.'");
    expect(source).toContain("return Astro.redirect('/admin/maintenance')");
  });
});
