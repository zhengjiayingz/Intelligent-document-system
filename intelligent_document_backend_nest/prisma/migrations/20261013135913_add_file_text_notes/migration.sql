-- CreateTable
CREATE TABLE `file_text_notes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `user_file_id` INTEGER NOT NULL,
    `start_offset` INTEGER NOT NULL,
    `end_offset` INTEGER NOT NULL,
    `quote` VARCHAR(8000) NOT NULL,
    `content` VARCHAR(2000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `file_text_notes_user_id_user_file_id_idx`(`user_id`, `user_file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `file_text_notes` ADD CONSTRAINT `file_text_notes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_text_notes` ADD CONSTRAINT `file_text_notes_user_file_id_fkey` FOREIGN KEY (`user_file_id`) REFERENCES `user_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
