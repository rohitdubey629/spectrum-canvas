<?php

declare(strict_types=1);

namespace Drupal\canvas_alt_checker;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\RevisionLogInterface;
use Drupal\Core\Language\LanguageInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StreamWrapper\PrivateStream;
use Drupal\Core\StreamWrapper\PublicStream;
use Drupal\file\FileInterface;

/**
 * Finds where an image shown in the page stores its alt text, and updates it.
 *
 * The preview only contains the image URL. That URL is mapped back to a file
 * entity, then to every image field item (on media, nodes, …) that references
 * the file. The alt text lives on those field items.
 */
final class ImageAltResolver {

  /**
   * Image fields whose alt is derived from elsewhere and must not be edited.
   */
  private const SKIPPED_FIELDS = ['media' => ['thumbnail']];

  /**
   * Maximum alt length allowed by the image field storage.
   */
  public const MAX_LENGTH = 512;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EntityFieldManagerInterface $entityFieldManager,
    private readonly LanguageManagerInterface $languageManager,
    private readonly AccountInterface $currentUser,
    private readonly TimeInterface $time,
  ) {}

  /**
   * Describes the stored alt text for an image URL.
   *
   * @return array{editable: bool, alt: ?string, required: bool, count: int, reason: ?string}
   */
  public function describe(string $src): array {
    $targets = $this->targets($src);
    if ($targets === NULL) {
      return $this->notEditable('This image is not a managed file (it comes from a template, code component or external URL).');
    }
    if ($targets === []) {
      return $this->notEditable('This image is not used in a Media item or image field.');
    }
    $editable = array_filter($targets, fn (array $t) => $t['editable']);
    if ($editable === []) {
      return $this->notEditable('You do not have permission to edit where this image is stored.');
    }
    $first = reset($editable);
    return [
      'editable' => TRUE,
      'alt' => (string) ($first['entity']->get($first['field'])->get($first['delta'])->alt ?? ''),
      'required' => (bool) array_filter($editable, fn (array $t) => $t['required']),
      'count' => count($editable),
      'reason' => NULL,
    ];
  }

  /**
   * Updates the alt text everywhere the current user may edit it.
   *
   * @return int
   *   Number of entities saved.
   *
   * @throws \InvalidArgumentException
   *   When the alt text is not acceptable or the image cannot be edited.
   */
  public function update(string $src, string $alt): int {
    $alt = trim($alt);
    if (mb_strlen($alt) > self::MAX_LENGTH) {
      throw new \InvalidArgumentException(sprintf('Alt text must be %d characters or fewer.', self::MAX_LENGTH));
    }
    $targets = array_filter($this->targets($src) ?? [], fn (array $t) => $t['editable']);
    if ($targets === []) {
      throw new \InvalidArgumentException($this->describe($src)['reason'] ?? 'This image cannot be edited.');
    }
    if ($alt === '' && array_filter($targets, fn (array $t) => $t['required'])) {
      throw new \InvalidArgumentException('Alt text is required for this image.');
    }

    // Group field items by entity so each entity is saved once.
    $byEntity = [];
    foreach ($targets as $t) {
      $key = $t['entity']->getEntityTypeId() . ':' . $t['entity']->id();
      $byEntity[$key]['entity'] = $t['entity'];
      $byEntity[$key]['items'][] = [$t['field'], $t['delta']];
    }

    foreach ($byEntity as ['entity' => $entity, 'items' => $items]) {
      foreach ($items as [$field, $delta]) {
        $entity->get($field)->get($delta)->alt = $alt;
      }
      $entityType = $entity->getEntityType();
      if ($entityType->isRevisionable()) {
        $entity->setNewRevision(TRUE);
        if ($entity instanceof RevisionLogInterface) {
          $entity->setRevisionLogMessage('Alt text updated from the Canvas Image Alt Checker.');
          $entity->setRevisionUserId((int) $this->currentUser->id());
          $entity->setRevisionCreationTime($this->time->getRequestTime());
        }
      }
      $entity->save();
    }
    return count($byEntity);
  }

  /**
   * Lists every image field item that references the file behind $src.
   *
   * @return list<array{entity: ContentEntityInterface, field: string, delta: int, editable: bool, required: bool}>|null
   *   NULL when $src is not a managed file.
   */
  private function targets(string $src): ?array {
    $file = $this->fileFromUrl($src);
    if (!$file) {
      return NULL;
    }
    $langcode = $this->languageManager->getCurrentLanguage(LanguageInterface::TYPE_CONTENT)->getId();
    $targets = [];

    foreach ($this->entityFieldManager->getFieldMapByFieldType('image') as $entityTypeId => $fields) {
      $storage = $this->entityTypeManager->getStorage($entityTypeId);
      foreach (array_keys($fields) as $fieldName) {
        if (in_array($fieldName, self::SKIPPED_FIELDS[$entityTypeId] ?? [], TRUE)) {
          continue;
        }
        $ids = $storage->getQuery()
          ->accessCheck(TRUE)
          ->condition($fieldName . '.target_id', $file->id())
          ->execute();
        foreach ($storage->loadMultiple($ids) as $entity) {
          \assert($entity instanceof ContentEntityInterface);
          if ($entity->hasTranslation($langcode)) {
            $entity = $entity->getTranslation($langcode);
          }
          $editable = $entity->access('update') && $entity->get($fieldName)->access('edit');
          $required = (bool) $entity->get($fieldName)->getFieldDefinition()->getSetting('alt_field_required');
          foreach ($entity->get($fieldName) as $delta => $item) {
            if ((int) $item->target_id === (int) $file->id()) {
              $targets[] = [
                'entity' => $entity,
                'field' => $fieldName,
                'delta' => $delta,
                'editable' => $editable,
                'required' => $required,
              ];
            }
          }
        }
      }
    }
    return $targets;
  }

  /**
   * Maps a public/private file URL (or an image style derivative) to a file.
   */
  private function fileFromUrl(string $src): ?FileInterface {
    $path = rawurldecode((string) parse_url($src, PHP_URL_PATH));
    $bases = [
      'public' => '/' . trim(PublicStream::basePath(), '/') . '/',
      'private' => '/system/files/',
    ];
    if (!PrivateStream::basePath()) {
      unset($bases['private']);
    }

    // Allow a base path prefix (Drupal in a subdirectory).
    foreach ($bases as $scheme => $base) {
      $pos = strpos($path, $base);
      if ($pos === FALSE) {
        continue;
      }
      $relative = substr($path, $pos + strlen($base));
      // Image style derivative: styles/{style}/{scheme}/{path}.
      if (preg_match('#^styles/[^/]+/(public|private)/(.+)$#', $relative, $m)) {
        $scheme = $m[1];
        $relative = $m[2];
      }
      $candidates = [$scheme . '://' . $relative];
      // Derivatives can add a format extension, e.g. photo.jpg.avif.
      if (preg_match('#^(.+\.[a-z0-9]+)\.(avif|webp|png|jpe?g)$#i', $relative, $m)) {
        $candidates[] = $scheme . '://' . $m[1];
      }
      $files = $this->entityTypeManager->getStorage('file')->loadByProperties(['uri' => $candidates]);
      if ($files) {
        $file = reset($files);
        return $file instanceof FileInterface ? $file : NULL;
      }
    }
    return NULL;
  }

  private function notEditable(string $reason): array {
    return ['editable' => FALSE, 'alt' => NULL, 'required' => FALSE, 'count' => 0, 'reason' => $reason];
  }

}
