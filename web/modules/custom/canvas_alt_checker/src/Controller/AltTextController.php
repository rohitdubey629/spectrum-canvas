<?php

declare(strict_types=1);

namespace Drupal\canvas_alt_checker\Controller;

use Drupal\canvas_alt_checker\ImageAltResolver;
use Drupal\Core\DependencyInjection\AutowireTrait;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * JSON endpoints used by the Image Alt Checker extension.
 */
final class AltTextController implements ContainerInjectionInterface {

  use AutowireTrait;

  /**
   * Limits how many images one lookup request may ask about.
   */
  private const MAX_LOOKUP = 200;

  public function __construct(
    private readonly ImageAltResolver $resolver,
  ) {}

  /**
   * POST {"srcs": ["/sites/default/files/a.jpg", …]}.
   *
   * Returns {"images": {"<src>": {editable, alt, required, count, reason}}}.
   */
  public function lookup(Request $request): JsonResponse {
    $body = json_decode($request->getContent(), TRUE);
    $srcs = is_array($body['srcs'] ?? NULL) ? $body['srcs'] : [];
    $srcs = array_slice(array_unique(array_filter($srcs, 'is_string')), 0, self::MAX_LOOKUP);

    $images = [];
    foreach ($srcs as $src) {
      $images[$src] = $this->resolver->describe($src);
    }
    return new JsonResponse(['images' => (object) $images]);
  }

  /**
   * POST {"src": "…", "alt": "…"}.
   */
  public function save(Request $request): JsonResponse {
    $body = json_decode($request->getContent(), TRUE);
    $src = $body['src'] ?? NULL;
    $alt = $body['alt'] ?? NULL;
    if (!is_string($src) || !is_string($alt)) {
      return new JsonResponse(['message' => 'Both "src" and "alt" are required.'], 400);
    }
    try {
      $saved = $this->resolver->update($src, $alt);
    }
    catch (\InvalidArgumentException $e) {
      return new JsonResponse(['message' => $e->getMessage()], 422);
    }
    return new JsonResponse(['saved' => $saved, 'alt' => trim($alt)]);
  }

}
