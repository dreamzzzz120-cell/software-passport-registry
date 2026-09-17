import { readFileSync } from 'node:fs';
const source = readFileSync('src/components/ScansView.tsx', 'utf8');
describe('ScansView evidence-backed UI contract', () => {
  it('requires explicit target selection', () => {
    expect(source).toContain("const [chosenClientName, setChosenClientName] = useState('');");
    expect(source).toContain("const [selectedPassportId, setSelectedPassportId] = useState('');");
    expect(source).toContain('Select a software passport');
    expect(source).toContain('Select a client');
    expect(source).not.toContain('clients[0].name');
    expect(source).not.toContain('passports[0].id');
  });
  it('does not claim a fixed eight-engine scanner count', () => {
    expect(source).not.toContain('8-engine AI Security pipeline');
    expect(source).toContain('configured software security analysis pipeline');
  });
  it('does not show an unconfirmed zero while schedules load', () => {
    expect(source).toContain("schedulesLoaded ? schedules.length : '—'");
    expect(source).toContain("!schedulesLoaded");
  });
});
