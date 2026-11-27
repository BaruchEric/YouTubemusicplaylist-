import { describe, expect, test } from 'bun:test';
import { createElement, Suspense, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { lazyComponent } from '../src/components/lazyComponent';

interface GreetingProps {
  name: string;
}

function Greeting({ name }: GreetingProps) {
  return createElement('p', null, `Hello ${name}`);
}

/** What the page shows on the first draw, with "waiting" standing in while code is fetched. */
function draw(node: ReactNode): string {
  return renderToString(createElement(Suspense, { fallback: 'waiting' }, node));
}

describe('lazyComponent', () => {
  test('shows the fallback while the code is on the way', () => {
    const neverArrives = new Promise<ComponentType<GreetingProps>>(() => {});
    const greeting = lazyComponent(() => neverArrives);

    const html = draw(createElement(greeting.Component, { name: 'Ada' }));

    expect(html).toContain('waiting');
    expect(html).not.toContain('Hello');
  });

  test('draws at once when the code was fetched ahead', async () => {
    const greeting = lazyComponent(async () => Greeting);
    await greeting.fetch();

    const html = draw(createElement(greeting.Component, { name: 'Ada' }));

    expect(html).toContain('Hello Ada');
    expect(html).not.toContain('waiting');
  });

  test('asks for the code once, however often it is fetched', async () => {
    let asked = 0;
    const greeting = lazyComponent(async () => {
      asked += 1;
      return Greeting;
    });

    await greeting.fetch();
    await greeting.fetch();
    draw(createElement(greeting.Component, { name: 'Ada' }));

    expect(asked).toBe(1);
  });

  test('a fetch ahead of time that fails does not stop a later one', async () => {
    let asked = 0;
    const greeting = lazyComponent(async () => {
      asked += 1;
      if (asked === 1) throw new Error('offline');
      return Greeting;
    });

    await expect(greeting.fetch()).rejects.toThrow('offline');
    await greeting.fetch();

    expect(draw(createElement(greeting.Component, { name: 'Ada' }))).toContain('Hello Ada');
  });
});
