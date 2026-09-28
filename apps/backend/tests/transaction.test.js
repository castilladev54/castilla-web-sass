import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { describe, test, beforeAll, afterAll, expect } from 'vitest';

describe('Mongo transaction smoke test', () => {
    let mongoServer;

    beforeAll(async () => {
        mongoServer = await MongoMemoryReplSet.create({
            binary: {
                version: '7.0.14',
            },
            replSet: {
                count: 1,
            },
            instanceOpts: [
                {
                    launchTimeout: 60000,
                },
            ],
        });

        await mongoose.connect(mongoServer.getUri());

        console.log(
            'SMOKE URI:',
            mongoServer.getUri(),
        );

        const hello = await mongoose.connection.db.admin().command({
            hello: 1,
        });

        console.log('SMOKE HELLO:', {
            setName: hello.setName,
            isWritablePrimary: hello.isWritablePrimary,
        });
    });

    afterAll(async () => {
        await mongoose.disconnect();

        if (mongoServer) {
            await mongoServer.stop();
        }
    });

    test('debe ejecutar una transacción simple', async () => {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            await mongoose.connection.db
                .collection('transaction_test')
                .insertOne(
                    {
                        value: 'test',
                    },
                    {
                        session,
                    },
                );

            await session.commitTransaction();

            const document =
                await mongoose.connection.db
                    .collection('transaction_test')
                    .findOne({
                        value: 'test',
                    });

            expect(document).not.toBeNull();
        } catch (error) {
            console.error('SMOKE TRANSACTION ERROR:', error);
            throw error;
        } finally {
            await session.endSession();
        }
    });
});