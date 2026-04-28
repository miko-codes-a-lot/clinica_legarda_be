import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from 'src/_shared/decorators/user.decorator';
import { UserDto } from 'src/auth/dto/user.dto';
import { UserUpsertDto } from './dto/user-upsert.dto';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { existsSync, statSync } from 'fs';
import { Public } from 'src/auth/auth.guard';

const profilePictureStorage = diskStorage({
  destination: './uploads/profile-pictures',
  filename: (req, file, cb) => {
    const userId = req.params.id;
    if (!userId) {
      return cb(new Error('User ID missing for file naming.'), '');
    }

    const randomName = Date.now();
    const fileExtension = extname(file.originalname);
    cb(null, `${userId}-${randomName}${fileExtension}`);
  },
});

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @HttpCode(HttpStatus.OK)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('profile')
  profile(@User() user: UserDto) {
    return this.usersService.findByOneUsername(user.username);
  }

  @HttpCode(HttpStatus.OK)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Get(':id/picture')
  async getProfilePicture(@Param('id') id: string, @Res() res: Response) {
    const user = await this.usersService.findOne(id);

    if (!user || !user.profilePicture) {
      return res.sendFile('default.png', {
        root: join(process.cwd(), 'assets'),
      });
    }

    const filePath = join(
      process.cwd(),
      'uploads',
      'profile-pictures',
      user.profilePicture,
    );

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return res.sendFile('default.png', {
        root: join(process.cwd(), 'assets'),
      });
    }
    const ext = user.profilePicture.split('.').pop()?.toLowerCase();
    const contentType =
      {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
      }[ext || ''] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    return res.sendFile(user.profilePicture, {
      root: join(process.cwd(), 'uploads', 'profile-pictures'),
    });
  }

  @Put(':id/pictures')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: profilePictureStorage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadProfilePicture(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    const updatedUser = await this.usersService.updateProfilePicture(
      id,
      file.filename,
    );

    return {
      message: 'Profile picture uploaded successfully',
      fileName: file.filename,
      user: updatedUser,
    };
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post()
  create(@Body() doc: UserUpsertDto) {
    return this.usersService.upsert(doc);
  }

  @HttpCode(HttpStatus.OK)
  @Put(':id')
  update(@Param('id') id: string, @Body() doc: UserUpsertDto) {
    return this.usersService.upsert(doc, id);
  }

  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  async register(@Body() doc: UserUpsertDto) {
    doc.role = 'user';
    return this.usersService.upsert(doc);
  }
}
