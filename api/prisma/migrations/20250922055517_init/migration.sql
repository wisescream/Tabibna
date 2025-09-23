-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `password_hash` VARCHAR(191) NULL,
    `role` ENUM('patient', 'practitioner', 'admin') NOT NULL DEFAULT 'patient',
    `first_name` VARCHAR(100) NULL,
    `last_name` VARCHAR(100) NULL,
    `locale` VARCHAR(5) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `practitioners_profiles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `specialty` VARCHAR(150) NULL,
    `bio` VARCHAR(191) NULL,
    `clinic_id` BIGINT NULL,
    `price_min` INTEGER NULL,
    `price_max` INTEGER NULL,
    `rating` DOUBLE NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `practitioners_profiles_user_id_key`(`user_id`),
    INDEX `practitioners_profiles_user_id_idx`(`user_id`),
    INDEX `practitioners_profiles_clinic_id_idx`(`clinic_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clinics` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(100) NULL,
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `phone` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedules` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `practitioner_id` BIGINT NOT NULL,
    `day_of_week` INTEGER NULL,
    `start_time` TIME(0) NULL,
    `end_time` TIME(0) NULL,
    `slot_duration_minutes` INTEGER NULL DEFAULT 15,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `schedules_practitioner_id_idx`(`practitioner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reservations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `patient_id` BIGINT NOT NULL,
    `practitioner_id` BIGINT NOT NULL,
    `clinic_id` BIGINT NULL,
    `start_datetime` DATETIME(3) NOT NULL,
    `end_datetime` DATETIME(3) NOT NULL,
    `status` ENUM('booked', 'confirmed', 'cancelled', 'completed', 'no_show') NOT NULL DEFAULT 'booked',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_pract_start`(`practitioner_id`, `start_datetime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `type` VARCHAR(50) NULL,
    `channel` VARCHAR(50) NULL,
    `payload` JSON NULL,
    `sent_at` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked` BOOLEAN NOT NULL DEFAULT false,

    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `practitioners_profiles` ADD CONSTRAINT `practitioners_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practitioners_profiles` ADD CONSTRAINT `practitioners_profiles_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedules` ADD CONSTRAINT `schedules_practitioner_id_fkey` FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_practitioner_id_fkey` FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
