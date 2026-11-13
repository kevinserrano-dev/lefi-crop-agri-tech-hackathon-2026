import { render, screen } from '@testing-library/react';
import { Markdown } from './Markdown';

describe('Markdown (Lefi AI answers)', () => {
  it('renders the Markdown a model writes, without asterisks or hashes', () => {
    const { container } = render(
      <Markdown
        text={[
          '## Zona A',
          'The **air temperature** is *21.5 °C* and `soil_moisture` is not measured.',
          '',
          '* **Water TDS:** 66 ppm',
          '* Water temperature: 18.9 °C',
          '',
          '1. Check the probe',
          '2. Ask a scout',
          '',
          '| Sensor | Value |',
          '|---|---|',
          '| air-1 | 21.5 |',
        ].join('\n')}
      />,
    );
    expect(container.textContent).not.toMatch(/\*|##|\|/);
    expect(screen.getByText('Zona A')).toBeInTheDocument();
    expect(screen.getByText('air temperature').tagName).toBe('STRONG');
    expect(screen.getByText('21.5 °C').tagName).toBe('EM');
    expect(screen.getByText('soil_moisture').tagName).toBe('CODE');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('keeps names with underscores as they are', () => {
    const { container } = render(<Markdown text="Variables: air_temperature and water_tds." />);
    expect(container.textContent).toBe('Variables: air_temperature and water_tds.');
    expect(container.querySelector('em')).toBeNull();
  });

  it('never turns text into HTML or links', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror=alert(1)> see [the docs](http://example.com)'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('the docs');
  });
});
