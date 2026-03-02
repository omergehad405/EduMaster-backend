const mongoose = require("mongoose")

const connectDB = async () => {
    try {
        const connection = await mongoose.connect(process.env.MONGO_URL);
        console.log("connected to mongoDB")
    } catch (err) {
        console.log("error while connecting to DB: " + err)
        process.exit(1)
    }
}

module.exports = connectDB;