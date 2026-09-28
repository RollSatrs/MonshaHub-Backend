import * as bcrypt from 'bcrypt';

export async function hashFunction(password: string){
    const hash = await bcrypt.hash(password, 10)
    return hash
}

export async function unHashFunction(password: string, hash: string) {
    const unHash = await bcrypt.compare(password, hash)
    return unHash
}