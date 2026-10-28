import { describe, expect, it } from 'vitest';
import { complete, COMMANDS } from '../src/terminal/commands';
import { tokenize, ParseError } from '../src/terminal/parser';
import { parseQuantity, UnitError } from '../src/terminal/units';
import { validateCreatorName } from '../src/lib/creatorName';
import { AU_KM } from '../src/physics/units';
import { makeConsole } from './helpers';

describe('parser', () => {
  it('tokenizes with quotes and rejects unclosed quotes', () => {
    expect(tokenize('body info "Earth-f1"')).toEqual(['body', 'info', 'Earth-f1']);
    expect(tokenize(`say 'two words'  x`)).toEqual(['say', 'two words', 'x']);
    expect(() => tokenize('body info "Earth')).toThrow(ParseError);
    expect(tokenize('body in', true)).toEqual(['body', 'in']);
    expect(tokenize('body ', true)).toEqual(['body', '']);
  });
});

describe('units', () => {
  it('converts explicit units and rejects bare or unknown units', () => {
    expect(parseQuantity(['2', 'Mearth'], 0, 'mass', 'm').value).toBeCloseTo(2 * 5.97219e24, -18);
    expect(parseQuantity(['1.5', 'au'], 0, 'length', 'x').value).toBeCloseTo(1.5 * AU_KM, 3);
    expect(parseQuantity(['1d'], 0, 'duration', 'd')).toEqual({ value: 1, used: 1 });
    expect(parseQuantity(['6', 'h'], 0, 'duration', 'd').value).toBeCloseTo(0.25, 12);
    expect(parseQuantity(['1', 'yr'], 0, 'duration', 'd').value).toBe(365.25);
    expect(parseQuantity(['24', 'km/s'], 0, 'speed', 'v').value).toBe(24);
    expect(() => parseQuantity(['5'], 0, 'mass', 'mass')).toThrow(/needs a unit/);
    expect(() => parseQuantity(['5', 'parsec'], 0, 'length', 'r')).toThrow(UnitError);
    expect(() => parseQuantity(['five', 'kg'], 0, 'mass', 'm')).toThrow(/not a number/);
    expect(() => parseQuantity(['0x10', 'kg'], 0, 'mass', 'm')).toThrow(UnitError);
  });
});

describe('basic commands and help', () => {
  it('keeps the Phase 1 commands working', () => {
    const c = makeConsole();
    expect(c.run('whoami').text).toBe('ada');
    expect(c.run('clear').out?.clear).toBe(true);
    expect(c.run('   ').out).toBeNull();
  });

  it('--help lists every registered command and nothing else', () => {
    const c = makeConsole();
    const text = c.run('--help').text;
    for (const cmd of COMMANDS) expect(text).toContain(` ${cmd.name}`);
    expect(text).not.toMatch(/not available|coming soon/i);
    expect(c.run('help').text).toBe(text);
  });

  it('has command and category help, and <cmd> --help', () => {
    const c = makeConsole();
    expect(c.run('help explode').text).toMatch(/usage:[\s\S]*explode <body>[\s\S]*--force/);
    expect(c.run('explode --help').text).toBe(c.run('help explode').text);
    expect(c.run('help god').text).toMatch(/God mode[\s\S]*supernova[\s\S]*freeze/);
  });

  it('suggests close matches for unknown commands, bodies and actions', () => {
    const c = makeConsole();
    const r = c.run('explod Earth');
    expect(r.kinds[0]).toBe('error');
    expect(r.text).toMatch(/`explode`/);
    expect(c.run('body info Eart').text).toMatch(/Did you mean "Earth"/);
    expect(c.run('sim paus').text).toMatch(/sim pause/);
    expect(c.run('body info').text).toMatch(/Missing body name/);
  });

  it('never executes anything like a shell or JavaScript', () => {
    const c = makeConsole();
    for (const raw of ['rm -rf /', 'eval alert(1)', '$(whoami)', 'window.location="x"']) {
      const r = c.run(raw);
      expect(r.kinds[0]).toBe('error');
    }
  });

  it('autocompletes commands, subcommands and body names', () => {
    const c = makeConsole();
    expect(complete('expl', c.ctx).value).toBe('explode ');
    expect(complete('body in', c.ctx).value).toBe('body info ');
    expect(complete('body info Ju', c.ctx).value).toBe('body info Jupiter ');
    const multi = complete('body info M', c.ctx);
    expect(multi.candidates).toEqual(['Mercury', 'Mars']);
    expect(complete('sim ', c.ctx).candidates).toContain('step');
  });
});

describe('creator names', () => {
  it('validates', () => {
    expect(validateCreatorName('ada_lovelace').ok).toBe(true);
    for (const bad of ['', ' ', 'a b', 'x'.repeat(21), 'a\u0007', '$(rm)']) expect(validateCreatorName(bad).ok).toBe(false);
  });
});
