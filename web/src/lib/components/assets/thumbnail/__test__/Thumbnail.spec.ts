import { render } from '@testing-library/svelte';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import Thumbnail from '$lib/components/assets/thumbnail/Thumbnail.svelte';
import { getTabbable } from '$lib/utils/focus-util';
import { assetFactory } from '@test-data/factories/asset-factory';

vi.mock('$lib/utils/navigation', () => ({
  currentUrlReplaceAssetId: vi.fn(),
  isSharedLinkRoute: vi.fn().mockReturnValue(false),
}));

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    enumerable: true,
    value: vi.fn().mockImplementation(function (query) {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
});

describe('Thumbnail component', () => {
  beforeAll(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  });

  it('should only contain a single tabbable element (the container)', () => {
    const asset = assetFactory.build({ originalPath: 'image.jpg', originalMimeType: 'image/jpeg' });
    const { baseElement } = render(Thumbnail, {
      asset,
      selected: true,
    });

    const container = baseElement.querySelector('[data-thumbnail-focus-container]');
    expect(container).not.toBeNull();
    expect(container!.getAttribute('tabindex')).toBe('0');

    // Guarding against inserting extra tabbable elements in future in <Thumbnail/>
    const tabbables = getTabbable(container!);
    expect(tabbables.length).toBe(0);
  });

  describe('Google Drive badge', () => {
    const imageAsset = () => assetFactory.build({ originalPath: 'image.jpg', originalMimeType: 'image/jpeg' });

    it('shows the badge for an asset already in Drive', () => {
      const { baseElement } = render(Thumbnail, { asset: imageAsset(), driveUploaded: true });
      expect(baseElement.querySelector('[data-icon-google-drive]')).not.toBeNull();
    });

    it('shows no badge otherwise', () => {
      const { baseElement } = render(Thumbnail, { asset: imageAsset() });
      expect(baseElement.querySelector('[data-icon-google-drive]')).toBeNull();
      // Witness that the thumbnail rendered, so the absence is about the badge alone.
      expect(baseElement.querySelector('[data-thumbnail-focus-container]')).not.toBeNull();
    });

    it('adds nothing tabbable', () => {
      // Same guard as the container test above: a decoration must not become a tab stop.
      const { baseElement } = render(Thumbnail, { asset: imageAsset(), driveUploaded: true });
      const container = baseElement.querySelector('[data-thumbnail-focus-container]');
      expect(getTabbable(container!).length).toBe(0);
    });
  });

  it('shows thumbhash while image is loading', () => {
    const asset = assetFactory.build({ originalPath: 'image.jpg', originalMimeType: 'image/jpeg' });
    const sut = render(Thumbnail, {
      asset,
      selected: true,
    });

    const thumbhash = sut.getByTestId('thumbhash');
    expect(thumbhash).not.toBeFalsy();
  });
});
